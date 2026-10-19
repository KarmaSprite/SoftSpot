/**
 * 二维打分里的第一维：一条主张跟已发表文献有多像。
 *
 * 这一步没有一个模型调用 —— 全是算术。理由很简单：
 * 让模型算分，同一段文字问两次会给两个数，而图上一个点今天在这儿、明天在那儿，
 * 用户就没法判断"我改完之后是不是变好了"。用代码算，同样的输入永远是同一个数。
 *
 * 另一个硬约束是**必须能解释**。答辩时老师会问"这个 63 分是怎么来的"，
 * 如果答案是"模型觉得"，那这一维就废了。所以每个分数都带三样东西：
 *   1. 命中了哪几个词（matched）
 *   2. 最像的那篇论文是哪篇（bestHit）
 *   3. 一句话说明（reason）
 *
 * 中文和英文分开算，不跨语种比：
 * 中文主张和英文论文之间没有可以逐字对应的词，
 * 硬要比只能靠翻译，而翻译已经在 L2-A 做过了 —— 这里比的是翻译出来的英文术语。
 * 所以一条主张会有两套词：英文的（来自检索意图）和中文的（来自原文和 zhQuery）。
 * 英文命中跟英文词比，中文命中跟中文词比，各取最高的那个。
 */

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

/** 分好词的文本，中英分开存 —— 跨语种没法逐词比。 */
export type TokenBag = {
  en: string[];
  zh: string[];
};

export type SimilarityDetail = {
  /** 主张和这篇文献共有的词，直接展示给用户看 */
  matched: string[];
  /** 主张这边一共有多少词，用来算覆盖率 */
  claimTokens: number;
  /** 覆盖率：主张的词有多大比例出现在这篇文献里 */
  coverage: number;
  /** 密度：这篇文献本身有多"集中"在说这件事 */
  density: number;
};

export type SimilarityResult = {
  /** 0-100，越大越像 */
  score: number;
  detail: SimilarityDetail;
};

/* ---------------------------------------------------------------
   1. 停用词
   --------------------------------------------------------------- */

/**
 * 英文停用词。
 *
 * 为什么要停用：这些词在任何论文里都出现，拿它们算相似度等于没算。
 * "a study of the effect of X on Y" —— 去掉 a / study / of / the / effect / on 之后
 * 剩下的才是真内容。
 */
const STOPWORDS_EN = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "at", "by", "for", "with",
  "about", "into", "through", "during", "before", "after", "above", "below",
  "to", "from", "in", "on", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "any", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "so", "than", "too", "very", "can", "will", "just",
  "should", "now", "is", "are", "was", "were", "be", "been", "being", "have",
  "has", "had", "having", "do", "does", "did", "doing", "would", "could",
  "ought", "i", "you", "he", "she", "it", "we", "they", "them", "his", "her",
  "its", "our", "their", "this", "that", "these", "those", "as", "also",
  "study", "studies", "paper", "article", "research", "result", "results",
  "based", "using", "used", "use", "new", "approach", "method", "methods",
]);

/**
 * 中文停用字。
 *
 * 中文按双字切，只要双字里有一个是这种字就丢掉。
 * 这批字出现频率极高但不承载信息（"的""了""在"），留着会让任意两句话都"相似"。
 */
const STOPCHARS_ZH = new Set(
  "的了在是和与及对为以把被从到而就都也还很更最这那有些一个我你他她它们上下中前后里外时之其所以及或但即".split(""),
);

/* ---------------------------------------------------------------
   2. 分词
   --------------------------------------------------------------- */

/**
 * 英文分词：小写 → 去标点 → 按空格和连字符切 → 去停用词 → 去复数/词尾。
 *
 * 为什么要去词尾：claim 里写 learning，论文标题里写 learn / learned，
 * 不归一到同一个词根，它们就被当成三个不同的词，白白漏掉匹配。
 * 这里只做最保守的几条规则（s / es / ies / ing / ed），不做完整词干提取 ——
 * 完整词干提取要引库，而且会把 vocational 削成 voc，反而更糟。
 */
export function tokenizeEnglish(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS_EN.has(word))
    .map(stemEnglish);

  return Array.from(new Set(words));
}

/** 英文词尾归一。顺序有讲究：先处理 ies，再 s，最后 ing/ed。 */
export function stemEnglish(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("ches")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  return word;
}

/**
 * 中文分词：按连续汉字切段，每段取相邻两字组成双字词。
 *
 * 为什么不引分词库：
 * jieba 之类要带 8MB 词典，对一个 30 天的个人项目来说是纯负担；
 * 而且分词库切错的时候你没法解释"为什么这两个词没匹配上"。
 *
 * 双字切法的取舍：
 *   好 —— 零依赖、可解释（"这两句共有了『学生』『视频』两个词"）、
 *         召回高（不需要词典就能切出所有可能的词）
 *   坏 —— 会产生一些不是词的组合（"生视"），所以只当特征用，不当语言理解用。
 *         对"查重"这件事够用：两句话真在说同一件事，双字重合度必然高。
 */
export function tokenizeChinese(text: string): string[] {
  const runs = text.match(/[\u4e00-\u9fa5]+/g) ?? [];
  const bigrams = new Set<string>();

  for (const run of runs) {
    // 单字段没有双字词，直接跳过
    for (let i = 0; i + 1 < run.length; i += 1) {
      const pair = run.slice(i, i + 2);
      // 含停用字的双字词丢掉："的学""了学"这种没信息
      if (STOPCHARS_ZH.has(pair[0]) || STOPCHARS_ZH.has(pair[1])) continue;
      bigrams.add(pair);
    }
  }

  return Array.from(bigrams);
}

/** 一次切好中英两套词。 */
export function tokenize(text: string): TokenBag {
  return {
    en: tokenizeEnglish(text),
    zh: tokenizeChinese(text),
  };
}

/* ---------------------------------------------------------------
   3. 单篇相似度
   --------------------------------------------------------------- */

/**
 * 覆盖率权重和密度权重的比例。
 *
 * 为什么覆盖率占大头（0.65）：
 * 用户问的是"这个想法别人做过吗"。判断这件事最直接的信号是
 * "你主张里的核心词，这篇论文提到了几个"。
 * 密度只用来防一种情况：一篇超长的综述什么词都有，覆盖率天然高，
 * 但那不代表它就在做同一件事。
 */
const WEIGHT_COVERAGE = 0.65;
const WEIGHT_DENSITY = 0.35;

/**
 * 密度计算的窗口。
 *
 * 一篇文献切成 200 个词，命中 8 个，密度只有 4% —— 但那不代表不像，
 * 只代表文献长。所以分母用 min(词数, 40)：
 * 命中 8 个词，在 40 词的窗口里就是 20%，这才是"集中程度"的合理读法。
 */
const DENSITY_WINDOW = 40;

/**
 * 算一条主张和一篇文献的相似度（0-1）。
 *
 * 公式：
 *   覆盖率 = 共有的词数 / 主张的词数          —— 主张被覆盖了多少
 *   密度   = 共有的词数 / min(文献词数, 40)    —— 文献有多集中
 *   相似度 = 0.65 × 覆盖率 + 0.35 × 密度
 *
 * 中英各算一次取最大值 —— 中文主张配中文文献、英文术语配英文文献，
 * 不会出现"中文词跟英文词比"这种没意义的比较。
 */
export function pairScore(claim: TokenBag, doc: TokenBag): SimilarityResult {
  const en = oneLanguageScore(claim.en, doc.en);
  const zh = oneLanguageScore(claim.zh, doc.zh);

  // 两种语种里更像的那个说了算
  const better = en.score >= zh.score ? en : zh;

  return {
    score: better.score,
    detail: {
      matched: better.matched,
      claimTokens: better.claimTokens,
      coverage: better.coverage,
      density: better.density,
    },
  };
}

type OneLanguage = {
  score: number;
  matched: string[];
  claimTokens: number;
  coverage: number;
  density: number;
};

function oneLanguageScore(claimTokens: string[], docTokens: string[]): OneLanguage {
  const empty: OneLanguage = {
    score: 0,
    matched: [],
    claimTokens: claimTokens.length,
    coverage: 0,
    density: 0,
  };

  if (claimTokens.length === 0 || docTokens.length === 0) return empty;

  const docSet = new Set(docTokens);
  const matched = claimTokens.filter((token) => docSet.has(token));

  if (matched.length === 0) return empty;

  const coverage = matched.length / claimTokens.length;
  const density = Math.min(matched.length / Math.min(docTokens.length, DENSITY_WINDOW), 1);

  return {
    score: WEIGHT_COVERAGE * coverage + WEIGHT_DENSITY * density,
    matched,
    claimTokens: claimTokens.length,
    coverage,
    density,
  };
}

/* ---------------------------------------------------------------
   4. 一条主张对上一批文献
   --------------------------------------------------------------- */

/**
 * 单篇相似度到多少才算"真的撞上了"。
 *
 * 0.45 是实测调出来的：同一主题不同做法的论文一般在 0.3-0.5，
 * 真正在做同一件事的会到 0.6 以上。取 0.45 是把"沾边"排除在外，
 * 只数"确实撞了"的篇数。
 */
const BREADTH_THRESHOLD = 0.45;

/** 每多一篇真撞上的，加几分。 */
const BREADTH_BONUS = 4;

/** 广度加分上限。不设上限的话，一个热门选题会被一堆低质量命中顶到 100。 */
const BREADTH_MAX = 12;

export type CorpusScore = {
  /** 0-100 */
  score: number;
  /** 最像的那一篇的下标，没命中时是 -1 */
  bestIndex: number;
  /** 最像的那一篇的细节，用来写"为什么是这个分" */
  best: SimilarityResult | null;
  /** 有几篇真的撞上了（单篇 >= BREADTH_THRESHOLD） */
  strongCount: number;
};

/**
 * 一条主张对上一批文献。
 *
 * 为什么用"最像的那一篇"而不是平均：
 * 平均会被一堆不相干的文献拉低。用户关心的是"有没有人做过跟我一样的"，
 * 只要有**一篇**真的撞上了，答案就是"有"，跟另外九篇不相干没关系。
 *
 * 为什么要加广度分：
 * 一篇撞上可能是巧合（比如那篇正好也提到了"高职"），
 * 三篇都撞上就很难说是巧合了。
 */
export function scoreCorpus(claim: TokenBag, docs: TokenBag[]): CorpusScore {
  if (docs.length === 0) {
    return { score: 0, bestIndex: -1, best: null, strongCount: 0 };
  }

  let bestIndex = -1;
  let bestScore = 0;
  let best: SimilarityResult | null = null;
  let strongCount = 0;

  docs.forEach((doc, index) => {
    const result = pairScore(claim, doc);
    if (result.score >= BREADTH_THRESHOLD) strongCount += 1;
    if (result.score > bestScore) {
      bestScore = result.score;
      bestIndex = index;
      best = result;
    }
  });

  // 广度加分：第一篇不算，从第二篇起每篇 +4，最多 +12
  const bonus = Math.min(Math.max(strongCount - 1, 0) * BREADTH_BONUS, BREADTH_MAX);
  const score = Math.min(100, Math.round(bestScore * 100) + bonus);

  return { score, bestIndex, best, strongCount };
}

/* ---------------------------------------------------------------
   5. 第二维：答得上来吗
   --------------------------------------------------------------- */

/**
 * 从质询问题的危险分反推"这条主张答得上来吗"。
 *
 * 为什么用**最高**危险分而不是平均：
 * 一条主张能不能守住，看最难的那个问题你能不能答上来。
 * 平均分会被"问了两个很温和的问题"这种假安全拉高 ——
 * 实际上只要有一个致命问题答不上来，这条主张就是站不住的。
 *
 * 所以：defensibility = 100 - 最危险的那个问题。
 */
export function defensibilityFromRisk(risks: number[]): number {
  if (risks.length === 0) {
    /*
       没被质询到的情形。
       给 50 而不是 100：没被问过不等于没问题，只是我们不知道。
       给 100 等于替用户宣布"这条很稳"，而我们没有任何依据。
    */
    return 50;
  }

  const worst = Math.max(...risks);
  return Math.min(100, Math.max(0, 100 - worst));
}
