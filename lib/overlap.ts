/**
 * 把 arXiv、Crossref、中文网页的命中合成一个"别人做过吗"的分数。
 *
 * 这一层的职责只有一个：**把几个库的命中摆到同一张桌上比较**，
 * 然后给出一句人话解释。
 *
 * 三件事必须在这里做完，不能留给界面：
 *   1. 去重。同一篇论文可能两个库都有（arXiv 预印本后来发在期刊上）。
 *      不去重的话，一篇论文会被数两遍，广度加分凭空多出来。
 *   2. arXiv 和 Crossref **不给权重差**（理由见 scoreOverlap 的注释），
 *      但中文网页要打折（理由见 WEB_PAGE_WEIGHT）。
 *   3. 说清"为什么是这个分"。分数本身没有说服力，
 *      "最像的是这篇《…》，共有『高职』『短视频』『教学』三个词"才有。
 */

import type { Claim, RetrievalQuery } from "./schema.ts";
import type { ArxivHit } from "./arxiv.ts";
import type { CrossrefHit } from "./crossref.ts";
import type { WebHit } from "./websearch.ts";
import type { ManualRef } from "./manual.ts";
import { looksLikePaper, cleanTitle } from "./websearch.ts";
import {
  scoreCorpus,
  tokenize,
  type TokenBag,
  type SimilarityResult,
} from "./similarity.ts";

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

/** 统一后的文献条目 —— 三个源的字段名不一样，先抹平。 */
export type UnifiedHit = {
  source: "arxiv" | "crossref" | "web" | "manual";
  /** arXiv id、DOI 或归一化 url，全局唯一，用来去重 */
  key: string;
  title: string;
  year: string;
  authors: string[];
  /** 期刊名、arXiv 分类或站点名，可能为空 */
  venue: string;
  url: string;
};

export type OverlapResult = {
  /** 0-100，越大越像"别人做过" */
  score: number;
  /** 一句话解释这个分怎么来的，直接显示给用户 */
  reason: string;
  /** 最像的那一篇，可能为空（一条都没查到） */
  bestHit: UnifiedHit | null;
  /** 最像的那一篇的细节，界面上可以展开看 */
  best: SimilarityResult | null;
  /** 共有的词，展示用 */
  matched: string[];
  /** 一共查回来多少篇（去重后） */
  totalHits: number;
  /** 有几个库真的答话了 —— 0 表示这次一个源都没查成，分数不可信 */
  sourcesAnswered: number;
};

/* ---------------------------------------------------------------
   1. 抹平两个库的字段
   --------------------------------------------------------------- */

export function fromArxiv(hit: ArxivHit): UnifiedHit {
  return {
    source: "arxiv",
    key: `arxiv:${hit.id}`,
    title: hit.title,
    year: hit.year,
    authors: hit.authors,
    venue: "arXiv",
    url: hit.url,
  };
}

export function fromCrossref(hit: CrossrefHit): UnifiedHit {
  return {
    source: "crossref",
    key: `doi:${hit.doi.toLowerCase()}`,
    title: hit.title,
    year: hit.year,
    authors: hit.authors,
    venue: hit.journal,
    url: hit.url,
  };
}

/**
 * 中文网页的命中。
 *
 * 标题先用 cleanTitle 洗一遍 —— 原始标题带着站名、期刊期号、
 * 甚至「标题 - 标题」的重复，直接拿去算相似度会凭空加分。
 * 洗过的标题同时用来去重和比相似度。
 *
 * year 从 date 里抠四位数字（实测格式 `2025-12-29T16:00:00+00:00`），
 * 抠不到就留空。
 */
export function fromWeb(hit: WebHit): UnifiedHit {
  const yearMatch = hit.date.match(/(\d{4})/);

  return {
    source: "web",
    key: hit.key,
    title: cleanTitleForScoring(hit.title),
    year: yearMatch ? yearMatch[1] : "",
    authors: [],
    venue: hit.site,
    url: hit.url,
  };
}

/**
 * 网页标题清洗的薄包装。
 *
 * 单独包一层而不是直接 import cleanTitle 用：
 * 洗标题的规则将来可能要按场景分叉（比如搜索结果页和详情页规则不同），
 * 有个函数挡着，改的时候只动这里，不用去翻 fromWeb。
 */
function cleanTitleForScoring(title: string): string {
  return cleanTitle(title);
}

/**
 * 用户自己粘进来的中文文献。
 *
 * 跟中文网页的关键区别：**不打折**。
 * 网页打折是因为里面混着课程广告、教材征订页 —— 那些能命中共同词，
 * 却不是在说"我做过这个研究"。而用户粘进来的，是他自己确认过的论文，
 * 哪怕只给了标题和期刊名，它也是"别人做过"的硬证据。
 *
 * key 用归一化标题：用户手上没有 DOI，也没法保证写对。
 * 归一化之后同一篇被粘两遍（一次带期刊名一次不带）会被 dedupeHits 合掉 ——
 * 注意 parseManualRefs 已经按标题去重过一遍，这里是第二道保险，
 * 防的是"手工文献和 arXiv/Crossref 查到的是同一篇"。
 */
export function fromManual(ref: ManualRef): UnifiedHit {
  return {
    source: "manual",
    key: `manual:${normalizeTitle(ref.title)}`,
    title: ref.title,
    year: ref.year,
    authors: [],
    venue: ref.venue,
    url: "",
  };
}

/**
 * 去重：先按 key，再按"归一化标题"。
 *
 * 为什么还要按标题去一次：
 * 同一篇论文在 arXiv 上是预印本、在 Crossref 上是正式版，
 * key 一个是 `arxiv:2608.06932`、一个是 `doi:10.1080/...`，key 对不上，
 * 但它就是同一篇东西。只按 key 去重会把它数两遍。
 *
 * 归一化标题 = 小写 + 只留字母数字和汉字。这样
 * "Video, Reflection and Transformation: Action Research"
 * 和 "Video reflection and transformation action research"
 * 会被认成同一篇。
 */
export function dedupeHits(hits: UnifiedHit[]): UnifiedHit[] {
  const seenKey = new Set<string>();
  const seenTitle = new Set<string>();
  const result: UnifiedHit[] = [];

  for (const hit of hits) {
    const titleKey = normalizeTitle(hit.title);
    if (seenKey.has(hit.key)) continue;
    // 标题太短的不当重复判断依据（"Editorial" 这种会误伤）
    if (titleKey.length >= 20 && seenTitle.has(titleKey)) continue;

    seenKey.add(hit.key);
    if (titleKey.length >= 20) seenTitle.add(titleKey);
    result.push(hit);
  }

  return result;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
    .trim();
}

/* ---------------------------------------------------------------
   2. 一条文献怎么变成可比较的词袋
   --------------------------------------------------------------- */

/**
 * 文献的词袋。
 *
 * 英文只取标题 —— **故意不取摘要**。
 * 理由：arXiv 的摘要动辄 1500 字符，一条主张才 30 个字，
 * 拿 30 个字去比 1500 个字，任何一篇摘要都会命中一堆词，
 * 于是所有主张的分数都会被拉到 60 以上，图上一个点都分不开。
 * 标题是作者自己浓缩过的一句话，跟"这条主张在说什么"可比得多。
 *
 * 中文取标题 + 期刊名 —— Crossref 里有中文论文（实测查得到），
 * 标题本身就是中文，直接能用双字切法比。
 */
export function hitTokens(hit: UnifiedHit): TokenBag {
  const en = tokenize(`${hit.title} ${hit.venue}`);
  const zh = tokenize(hit.title);
  return { en: en.en, zh: zh.zh };
}

/**
 * 主张的词袋。
 *
 * 英文词来自 L2-A 翻译出来的术语（phrase + keywords），不是从中文硬翻 ——
 * 那批词是模型专门为了检索挑出来的，跟英文论文标题最可比。
 * 中文词来自主张原文 + zhQuery（模型给的中文核心词）。
 */
export function claimTokens(claim: Claim, intent: RetrievalQuery | null): TokenBag {
  const en = intent
    ? tokenize([intent.phrase, ...intent.keywords].join(" "))
    : { en: [], zh: [] };
  const zh = tokenize(`${claim.text} ${intent?.zhQuery ?? ""}`);

  return {
    en: Array.from(new Set(en.en)),
    zh: Array.from(new Set(zh.zh)),
  };
}

/* ---------------------------------------------------------------
   3. 主函数
   --------------------------------------------------------------- */

/**
 * 两个学术库的分数怎么合。
 *
 * **不给 arXiv 和 Crossref 不同权重**，直接混在一个池子里比。理由：
 * 一篇正式发表的论文和一篇预印本，对"这个想法别人做过吗"这个问题
 * 是同等证据。按库给权重等于说"期刊比预印本更算数"，
 * 那是在替用户判断学术品味，不是我们该做的事。
 * 唯一的例外是同一篇东西两个库都有 —— 那种情况在 dedupeHits 里已经合掉了。
 *
 * **但中文网页要打折**，见 WEB_PAGE_WEIGHT。
 */

/**
 * 中文网页的权重。
 *
 * 为什么要打折：一篇正式发表的论文和一篇 CSDN 笔记，对"别人做过吗"
 * 是不同强度的证据。网页里混着课程广告、教材征订页、校园新闻，
 * 它们能命中一堆共同词，却根本不是在说"我做过这个研究"。
 *
 * 为什么是 0.7：这是**没有实验依据的保守估计**，靠的是两条约束 ——
 *   - 取 1.0：博客文章跟论文同权，一个 CSDN 笔记就能把主张推到"撞车"象限
 *   - 取 0.5：真论文发在非学术站点上时也会被压掉，漏报比误报更糟
 * 0.7 意味着**只有近乎同题**的网页才推得到 70 分（撞车线）：
 * 一篇相似度 1.0 的网页 → 70 分，刚好够撞车；
 * 相似度 0.6 的网页 → 42 分，只算"有重合"。
 *
 * 这个数改了会影响一个点落在哪个象限。答辩被问"这个 0.7 哪来的"，
 * 诚实的答案是"没有数据支撑，是个保守估计"，不要编。
 */
export const WEB_PAGE_WEIGHT = 0.7;

/** 学术库站点或标题像论文的网页，不打折 —— 它本来就是论文。 */
export const WEB_PAPER_WEIGHT = 1.0;

/**
 * 用户自己粘的文献的权重。
 *
 * 跟学术库一样给 1.0。理由：这是用户确认过的论文，
 * 不是我们在网上捞到的模糊结果。给他打折等于说"你说的不算"。
 *
 * 唯一的顾虑是用户可能粘一堆不相关的标题把分数抬上去 ——
 * 但那要求标题跟主张真有共同词，随便粘几篇是抬不动的。
 * 真怕这个的话，站长的 SITE.manualRefs 开关能整个关掉。
 */
export const MANUAL_WEIGHT = 1.0;

export type OverlapInput = {
  claim: Claim;
  intent: RetrievalQuery | null;
  arxivHits: ArxivHit[];
  crossrefHits: CrossrefHit[];
  /** 中文网页命中。没查或没配 key 时是空数组 */
  webHits?: WebHit[];
  /** 用户自己粘的中文文献。没开这个功能或没粘时是空数组 */
  manualRefs?: ManualRef[];
  /** 有几个源真的答话了。0 表示分数不可信，要显式告诉用户 */
  sourcesAnswered: number;
};

export function scoreOverlap(input: OverlapInput): OverlapResult {
  const {
    claim,
    intent,
    arxivHits,
    crossrefHits,
    webHits = [],
    manualRefs = [],
    sourcesAnswered,
  } = input;

  const unified = dedupeHits([
    ...arxivHits.map(fromArxiv),
    ...crossrefHits.map(fromCrossref),
    ...webHits.map(fromWeb),
    ...manualRefs.map(fromManual),
  ]);

  /*
      每篇的权重。
      学术库（arXiv / Crossref）和"看起来像论文的网页"都是 1.0，
      普通网页是 WEB_PAGE_WEIGHT，用户自己粘的也是 1.0。
      注意这里要跟 unified 同序 —— 所以按统一后的条目重新算，
      不能直接用 webHits 的顺序（去重和拼接都会改变下标）。
  */
  const weights = unified.map((hit) => {
    if (hit.source === "manual") return MANUAL_WEIGHT;
    if (hit.source !== "web") return WEB_PAPER_WEIGHT;
    // 站点名在 unified 里放在 venue 字段上
    return looksLikePaper({ site: hit.venue, title: hit.title }) ? WEB_PAPER_WEIGHT : WEB_PAGE_WEIGHT;
  });

  const claimBag = claimTokens(claim, intent);

  /*
     一个源都没答话（全部超时/报错）时，分数必须是 0 且**必须说明原因**。
     这里绝不能返回一个"看起来还行"的分 ——
     那会把"我不知道"伪装成"没人做过"，正是这个产品最不能犯的错。
  */
  if (sourcesAnswered === 0) {
    return {
      score: 0,
      reason: "这次一个数据库都没查成，分数不算数。先看报告顶上的警告。",
      bestHit: null,
      best: null,
      matched: [],
      totalHits: 0,
      sourcesAnswered: 0,
    };
  }

  if (unified.length === 0) {
    return {
      score: 0,
      reason: "查了，一篇都没查到。要么这个方向确实新，要么检索词没翻准。",
      bestHit: null,
      best: null,
      matched: [],
      totalHits: 0,
      sourcesAnswered,
    };
  }

  const docs = unified.map(hitTokens);
  const corpus = scoreCorpus(claimBag, docs, weights);

  if (corpus.best === null || corpus.bestIndex < 0) {
    return {
      score: 0,
      reason: `查回来 ${unified.length} 篇，但没有一篇跟这条主张沾边。`,
      bestHit: null,
      best: null,
      matched: [],
      totalHits: unified.length,
      sourcesAnswered,
    };
  }

  const bestHit = unified[corpus.bestIndex];

  return {
    score: corpus.score,
    reason: buildReason(corpus.score, bestHit, corpus.best, corpus.strongCount, unified.length),
    bestHit,
    best: corpus.best,
    matched: corpus.best.detail.matched,
    totalHits: unified.length,
    sourcesAnswered,
  };
}

/* ---------------------------------------------------------------
   4. 解释文案
   --------------------------------------------------------------- */

/**
 * 三档说法，对应三种该采取的行动。
 *
 * 为什么不用连续的语气（"相似度 63.2%"）：
 * 用户拿到的不是数字，是"我该改哪里"。数字只用来排点，
 * 文案要告诉他下一步做什么。
 *
 * 最像的那一篇是用户自己粘的时候，开头换一个说法 ——
 * 不然会出现「查回来 12 篇，最像的是 2023 年《…》」这种让人困惑的话：
 * 那篇不是我们查回来的，是他自己给的。
 */
function buildReason(
  score: number,
  best: UnifiedHit,
  bestSimilarity: SimilarityResult,
  strongCount: number,
  totalHits: number,
): string {
  const title = truncate(best.title, 46);
  const where = best.year ? `${best.year} 年` : "年份不明";
  const venue = best.venue ? `《${best.venue}》` : "";

  /*
      你自己粘的那一篇最像时，文案要说明"这是你给的"。
      这件事很重要：用户会以为是我们查到的，从而高估这份报告的检索覆盖。
  */
  const selfPrefix = best.source === "manual" ? "你自己粘的那篇" : "";
  const selfTail = best.source === "manual" ? "（这条分里算上了你粘的文献）" : "";

  if (score >= 70) {
    return `撞车了。${selfPrefix}${where}${venue}「${title}」跟你这条几乎是一回事，${strongCount} 篇都对得上。这条主张得换个角度，或者明确说清你比它多做的是什么。${selfTail}`;
  }

  if (score >= 50) {
    return `有重合。最像的是${selfPrefix}${where}「${title}」，${strongCount} 篇沾边。别人做过相邻的事，但没做到你这个位置 —— 答辩时要把"我跟它差在哪"讲清楚。${selfTail}`;
  }

  if (score >= 25) {
    return `沾一点边。最像的是${selfPrefix}${where}「${title}」，但共有的词不多。大概率是同一个大领域里的另一件事。${selfTail}`;
  }

  if (totalHits > 0) {
    return `基本没人做过。查回来 ${totalHits} 篇，最像的那篇「${title}」也只沾了个边。这是你的机会，但也要准备好"为什么别人没做"这个问题。${selfTail}`;
  }

  return "查回来一篇都没有。";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
