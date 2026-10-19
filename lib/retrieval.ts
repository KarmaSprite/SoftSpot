/**
 * L2-A 检索意图翻译：中文主张 → 英文学术检索词 → 真正能发出去的查询串。
 *
 * 这一步为什么不直接用一个自然语言长句去查：
 * 第 9 步实测过，arXiv 的 AND 是严格的，但**短语要求整串原样出现**。
 * 一句完整的英文翻译里有十几个词，没有任何一篇论文的摘要会把它们连着写出来，
 * 结果就是查 0 条 —— 看起来像"没人做过"，实际上是我们自己把查询写坏了。
 * 而这个产品最不能犯的错误，就是把"我查不到"说成"没人做过"。
 *
 * 所以这里分四步：
 *   1. 模型把中文主张抽象成领域术语（phrase + keywords），不逐字翻译
 *   2. 代码检查形态：全是英文、术语长度合理、关键词去重
 *   3. 代码把三种查询串各自拼成合规的形态：
 *        短语      all:"shot language"
 *        拆词      all:shot AND all:language AND all:vocational
 *        自洽      all:"shot language" AND all:vocational
 *      然后取并集 —— 短语查不到的时候，拆词往往还能捞到东西
 *   4. 任何一条主张翻坏了，只影响那一条，其余照常出结果
 */

import { parseWith } from "./parse.ts";
import { buildRetrievalMessages } from "./prompts.ts";
import { RawRetrievalSchema, type Claim, type RetrievalQuery } from "./schema.ts";
import type { ModelCaller } from "./extract.ts";

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

export type RetrievalOk = {
  ok: true;
  data: RetrievalQuery[];
  /** 个别主张翻坏时记在这里 —— 报告仍能出，但要让人知道哪条没查成。 */
  warnings: string[];
};

export type RetrievalBad = {
  ok: false;
  error: string;
};

export type RetrievalOutcome = RetrievalOk | RetrievalBad;

/**
 * 三个总开关的阈值。都是实测调出来的，不是拍脑袋。
 */

/** 单个术语最多几个词。超过 3 个词的短语在 arXiv 里几乎必然 0 条。 */
const MAX_TERMS_PER_PHRASE = 4;

/** 关键词最少几个。少于 2 个说明模型偷懒了，只抓到一个词就交差。 */
const MIN_KEYWORDS = 2;

/* ---------------------------------------------------------------
   1. 纯代码：检查翻译出来的东西能不能用
   --------------------------------------------------------------- */

/**
 * 判断一个术语是不是"能被检索的形态"。
 *
 * 这里查三件事：
 *   1. 是不是纯英文（模型偶尔会把中文漏出来，或者把拼音当英文）
 *   2. 词数是不是太多（超过 4 个词的短语在 arXiv 里基本查不到）
 *   3. 有没有多余标点（模型爱在术语后面加句号或引号）
 *
 * 返回空数组表示没问题，否则返回人话说明。
 */
export function checkTerm(term: string, kind: "phrase" | "keyword"): string[] {
  const problems: string[] = [];
  const trimmed = term.trim();

  if (trimmed.length === 0) {
    return [`${kind} 是空的`];
  }

  // 有中文或全角标点：模型没翻干净
  if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(trimmed)) {
    problems.push(`${kind}「${trimmed}」里还有中文，没翻干净`);
  }

  // 有非 ASCII 字母：可能是拼音或者带音符的英文，都当可疑处理
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(trimmed) && problems.length === 0) {
    problems.push(`${kind}「${trimmed}」里有非英文字符`);
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > MAX_TERMS_PER_PHRASE) {
    problems.push(`${kind}「${trimmed}」有 ${words.length} 个词，太长，查出来大概率是 0 条`);
  }

  // 标点：术语里只允许连字符（project-based）和空格
  if (/[.,;:!?'"()[\]{}]/.test(trimmed)) {
    problems.push(`${kind}「${trimmed}」里有标点，只保留字母、空格和连字符`);
  }

  return problems;
}

/**
 * 把模型给的术语洗一遍：去空格、转小写、去重、掐掉空的。
 *
 * 为什么要转小写：arXiv 虽然不分大小写，但报告里要显示给用户看，
 * 同一个列表里混着 "Shot Language" 和 "shot language" 会显得很乱。
 */
export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const cleaned = item.trim().replace(/\s+/g, " ").toLowerCase();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
}

/* ---------------------------------------------------------------
   2. 纯代码：把检索意图拼成各数据库认的查询串
   --------------------------------------------------------------- */

/**
 * 拼 arXiv 查询串。
 *
 * arXiv 用的是它自己的 Solr 方言，实测：
 *   all:"shot language"                        → 按短语匹配
 *   all:shot AND all:language AND all:vocational → 按词匹配
 *   all:"shot language" AND all:vocational     → 短语 + 词
 *
 * 两种写法的召回差很多（实测 0 条 vs 2 条），
 * 所以不要只发一种 —— 见下面的 buildArxivQueries。
 *
 * @param mode
 *   "phrase"  只查整串短语。精确，但容易 0 条。
 *   "words"   把短语拆成单词再 AND。宽，但会混进不相干的。
 *   "mixed"   短语 AND 一个关键词。折中。
 */
export function buildArxivQuery(
  intent: RetrievalQuery,
  mode: "phrase" | "words" | "mixed",
): string {
  const phraseWords = intent.phrase.split(/\s+/).filter(Boolean);

  if (mode === "phrase") {
    return `all:"${intent.phrase}"`;
  }

  if (mode === "words") {
    // 短语拆开 + 后面每个关键词的第一个词，一起去重后 AND
    const pool = new Set<string>();
    for (const word of phraseWords) pool.add(word.toLowerCase());
    for (const keyword of intent.keywords) {
      const first = keyword.split(/\s+/)[0];
      if (first) pool.add(first.toLowerCase());
    }
    return Array.from(pool)
      .map((word) => `all:${word}`)
      .join(" AND ");
  }

  // mixed：短语本身 + 一个补充关键词（跳过和短语重复的那个）
  const extra = intent.keywords.find(
    (keyword) => keyword.toLowerCase() !== intent.phrase.toLowerCase(),
  );
  if (!extra) {
    return `all:"${intent.phrase}"`;
  }
  return `all:"${intent.phrase}" AND all:"${extra}"`;
}

/**
 * 一条主张该发的全部 arXiv 查询。
 *
 * 为什么默认三种都发：
 * 实测「action research」+ vocational 短语查 0 条、拆词查 2 条。
 * 只发短语会漏，只发拆词会混进大量噪声。
 * 三个都发再按 arXiv id 去重合并，召回和精度都保住。
 *
 * 但真跑批量分析时不能三种都发 —— 见 modes 参数：
 * arXiv 官方限速是 3 秒一次，一次分析 9 条主张，
 * 三种全发 = 27 次请求 = 至少 78 秒纯等待，
 * 产品承诺的「60 秒出报告」直接破产。
 *
 * 所以调用方（lib/search.ts）传 modes = ["mixed", "words"]：
 * 砍掉纯短语那种（mixed 拼出来的就是「短语 AND 关键词」，已经覆盖了），
 * 把时间预算留给「每条主张都查得完」而不是「每条主张查得最全」。
 * 少查到的部分由第 19 步手工粘贴补。
 * 默认值保持三种全发，自检和手工排查时用得上。
 */
export function buildArxivQueries(
  intent: RetrievalQuery,
  modes: Array<"phrase" | "words" | "mixed"> = ["mixed", "words", "phrase"],
): string[] {
  const queries = modes.map((mode) => buildArxivQuery(intent, mode));

  // 有可能三种拼出来是同一个串（比如只有一个关键词），去重避免白花一次限速
  return Array.from(new Set(queries));
}

/**
 * 拼 Crossref 查询串。
 *
 * Crossref 吃的是自然语言，不需要 AND / 引号那套语法 ——
 * 它自己搞定分词，加引号反而可能一个词都匹配不上（实测）。
 * 所以这里就是把术语按"最核心的在前"排好，空格连起来。
 */
export function buildCrossrefQuery(intent: RetrievalQuery): string {
  const parts: string[] = [intent.phrase, ...intent.keywords];

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const part of parts) {
    const cleaned = part.trim().toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    ordered.push(cleaned);
  }

  return ordered.join(" ");
}

/* ---------------------------------------------------------------
   3. 单条主张
   --------------------------------------------------------------- */

type OneResult =
  | { ok: true; intent: RetrievalQuery; warnings: string[] }
  | { ok: false; error: string };

async function translateOne(
  claim: Claim,
  outline: string,
  callModel: ModelCaller,
): Promise<OneResult> {
  const { system, user } = buildRetrievalMessages(claim, outline);

  let raw: string;
  try {
    raw = await callModel(system, user);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `调用模型失败：${detail}` };
  }

  const parsed = parseWith(RawRetrievalSchema, raw);
  if (!parsed.ok) {
    return { ok: false, error: `模型返回的内容不符合要求：${parsed.error}` };
  }

  const warnings: string[] = [];
  const phrase = parsed.data.phrase.trim().replace(/\s+/g, " ").toLowerCase();
  const keywords = normalizeKeywords(parsed.data.keywords);
  const zhQuery = parsed.data.zhQuery.trim().replace(/\s+/g, " ");

  // ---- 形态检查 ----

  const phraseProblems = checkTerm(phrase, "phrase");
  if (phraseProblems.length > 0) {
    /*
       短语坏了要不要整条作废？
       不要。短语只是三种查询模式里的一种，拆词模式还能用。
       所以这里只打警告，让下游知道这条主张的短语模式可能不准。
    */
    warnings.push(`「${shorten(claim.text)}」的英文短语有问题：${phraseProblems.join("；")}`);
  }

  const badKeywords = keywords
    .map((keyword) => ({ keyword, problems: checkTerm(keyword, "keyword") }))
    .filter((item) => item.problems.length > 0);

  for (const item of badKeywords) {
    warnings.push(`「${shorten(claim.text)}」的关键词有问题：${item.problems.join("；")}`);
  }

  /*
     去掉坏的关键词，只留能用的。
     为什么不整条拒绝：一条主张翻出 4 个词，坏 1 个还剩 3 个能查，
     因为 1 个词坏掉就丢掉整条主张，等于告诉用户"这条没人做过"，那是假信息。
  */
  const goodKeywords = keywords.filter(
    (keyword) => checkTerm(keyword, "keyword").length === 0,
  );

  if (goodKeywords.length === 0) {
    return {
      ok: false,
      error: `翻译出来的关键词全部不可用（${keywords.join(" / ")}），这条主张没法查`,
    };
  }

  if (goodKeywords.length < MIN_KEYWORDS) {
    warnings.push(`「${shorten(claim.text)}」只翻出 ${goodKeywords.length} 个可用关键词，可能查不全`);
  }

  /*
     短语如果坏了，用第一个好关键词顶上。
     这样下游拿到的 phrase 永远是可用的东西，不用到处判空。
  */
  const finalPhrase = phraseProblems.length === 0 ? phrase : goodKeywords[0];

  return {
    ok: true,
    intent: {
      claimId: claim.id,
      phrase: finalPhrase,
      keywords: goodKeywords,
      zhQuery,
    },
    warnings,
  };
}

/** 把长主张截短，用在警告文案里。 */
function shorten(text: string, max = 18): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/* ---------------------------------------------------------------
   4. 主函数
   --------------------------------------------------------------- */

/**
 * 把每条主张翻译成英文检索意图。
 *
 * 失败策略跟第 8 步一致：**单条失败不拖垮整体**。
 * 6 条主张里第 3 条翻坏了，用户至少能看到另外 5 条查出来什么，
 * 外加一句"第 3 条没查成"。只有全部失败才返回错误。
 *
 * 为什么是串行不是并发：
 * 这一步只是调模型（不涉及 arXiv 限速），并发 6 个请求 DeepSeek 那边会排队，
 * 总时长差不多，但并发会让错误更难定位（不知道是哪一条超时）。
 * 第 13 步会统一改并发，那时候一起算账。
 */
export async function translateClaims(
  claims: Claim[],
  outline: string,
  callModel: ModelCaller,
): Promise<RetrievalOutcome> {
  if (claims.length === 0) {
    return { ok: false, error: "没有主张可以翻译，先抽取主张。" };
  }

  const all: RetrievalQuery[] = [];
  const warnings: string[] = [];

  for (const claim of claims) {
    const result = await translateOne(claim, outline, callModel);

    if (result.ok) {
      all.push(result.intent);
      warnings.push(...result.warnings);
    } else {
      warnings.push(`「${shorten(claim.text)}」这条主张没翻出检索词：${result.error}`);
    }
  }

  if (all.length === 0) {
    return {
      ok: false,
      error: `全部 ${claims.length} 条主张都没翻出来。最后一条的报错：${warnings[warnings.length - 1] ?? "未知"}`,
    };
  }

  return { ok: true, data: all, warnings };
}
