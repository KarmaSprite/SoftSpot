/**
 * 一条主张的完整检索：翻译出来的术语 → 真去两个库查 → 去重 → 打分。
 *
 * 这一层的唯一职责是**把多个可能失败的源拼成一份总能交出来的结果**。
 *
 * 为什么必须这样设计：
 * 第 9 步和第 10 步都实测到过源挂掉 —— arXiv 15 秒超时、Crossref 返回 200 但空 body。
 * 如果这里用 Promise.all，任何一个源挂了整个请求就抛异常，
 * 用户等 80 秒后看到的是"出错了"，而不是"arXiv 这次没查成，但 Crossref 查到了 3 篇"。
 *
 * 所以：
 *   1. 用 Promise.allSettled，不用 Promise.all
 *   2. 每个源的结果单独记，成功就是成功，失败就记一句人话
 *   3. 只要**有一个**源答话了，分数就是有效的（哪怕它说"一篇都没有"）
 *   4. 一个源都没答话时，分数标成不可信，绝不假装"没人做过"
 *
 * 第 3 点和第 4 点的区别是这个产品的良心所在：
 *   「查了，没有」 和 「没查成」 是两件事，混成一件就等于骗人。
 */

import { searchArxiv, type ArxivHit, type ArxivOutcome } from "./arxiv.ts";
import { searchCrossref, type CrossrefHit, type CrossrefOutcome } from "./crossref.ts";
import { scoreOverlap, type OverlapResult } from "./overlap.ts";
import { buildArxivQueries, buildCrossrefQuery } from "./retrieval.ts";
import type { Claim, RetrievalQuery } from "./schema.ts";

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

/** 一个检索源的结局。ok 和 error 二选一，不存在"两者都没有"的中间态。 */
export type SourceReport = {
  /** 源的名字，用来写警告文案 */
  name: "arXiv" | "Crossref";
  /** 这个源答话了吗 */
  answered: boolean;
  /** 答话时取回多少篇（去重前） */
  hitCount: number;
  /** 没答话时的人话原因 */
  error: string;
};

/** 一条主张的检索结果。 */
export type ClaimSearch = {
  claimId: string;
  /** 这个分数可不可信 —— 一个源都没答话时为 false */
  trustworthy: boolean;
  /** 合成后的分数、理由、最像的那一篇 */
  overlap: OverlapResult;
  /** 每个源各自怎么了，界面上可以展开看 */
  sources: SourceReport[];
  /** 这条主张的检索意图，可能为 null（翻译失败时） */
  intent: RetrievalQuery | null;
  /** 查回来去重前的原始命中数 */
  rawHitCount: number;
  /** 这次检索花的毫秒数 */
  elapsedMs: number;
};

/** 一条主张的检索结局。整条失败只在"没有检索意图"时发生。 */
export type ClaimSearchOutcome =
  | { ok: true; data: ClaimSearch }
  | { ok: false; error: string };

/* ---------------------------------------------------------------
   1. 可注入的检索器
   --------------------------------------------------------------- */

/**
 * 两个检索函数做成可注入的参数。
 *
 * 这不是为了"架构好看"，是为了能测。
 * 降级逻辑最需要测的就是"源挂了会怎样"，而真让 arXiv 挂掉
 * 得等它自己超时（15 秒），测三个用例要等 45 秒，没人愿意跑。
 * 注入之后，一个返回 reject 的假函数就能模拟超时。
 *
 * 默认值就是真的那两个，生产代码不用传。
 */
export type Searchers = {
  arxiv: (query: string) => Promise<ArxivOutcome>;
  crossref: (query: string) => Promise<CrossrefOutcome>;
};

export const REAL_SEARCHERS: Searchers = {
  arxiv: (query) => searchArxiv(query, { maxResults: 5 }),
  crossref: (query) => searchCrossref(query, { rows: 5 }),
};

/**
 * 一条主张给 arXiv 发几种查询。这里只发一种：拆词。
 *
 * 为什么只发一种 —— 时间账：
 * arXiv 官方限速 3 秒一次请求（lib/arxiv.ts 里 MIN_INTERVAL_MS = 3000）。
 * 一次真实分析抽出来 9 条主张，每条发 3 种查询 = 27 次请求 = 78 秒纯等待，
 * 加上模型那 30 多秒，一次分析要两分钟，产品承诺的「60 秒出报告」直接破产。
 * 发 1 种 = 9 次请求 = 27 秒，总时长才回到 60 秒上下。
 *
 * 为什么砍掉的是短语和混合，留下拆词：
 * 第 9 步实测过同一组词 ——
 *   `all:"action research" AND all:vocational` → 0 篇
 *   `all:action AND all:research AND all:vocational` → 2 篇
 * 拆词的召回明显更高。而这里最怕的错误方向是"漏掉一篇真论文"，
 * 那会让用户以为没人做过；多查回几篇噪声只是分数偏高一点，可以解释。
 *
 * 那精度靠谁保？靠 Crossref。它吃自然语言，lib/retrieval.ts 的
 * buildCrossrefQuery 把 phrase 排在最前面，等于把短语的精度交给它。
 * 两个源各干自己擅长的事：arXiv 保召回，Crossref 保精度。
 */
const ARXIV_MODES: Array<"phrase" | "words" | "mixed"> = ["words"];

/* ---------------------------------------------------------------
   2. 查一个源
   --------------------------------------------------------------- */

type ArxivBatch = {
  report: SourceReport;
  hits: ArxivHit[];
};

/**
 * 查 arXiv。一条主张要发好几个查询（短语 / 拆词 / 混合），
 * 这里串行发 —— arXiv 限速 3 秒一次，并发只会全部撞 429。
 *
 * 多个查询的结果按 id 去重合并：同一个查询串在三种模式下可能拼出一样的东西，
 * 不同的查询串也可能命中同一篇论文。
 *
 * 只要**有一个查询**答话了，就算这个源答话了。
 * 哪怕它答的是"0 篇" —— 那也是答了。
 */
async function searchArxivForClaim(
  queries: string[],
  searchers: Searchers,
): Promise<ArxivBatch> {
  const hits: ArxivHit[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let answeredCount = 0;

  for (const query of queries) {
    let outcome: ArxivOutcome;
    try {
      outcome = await searchers.arxiv(query);
    } catch (e) {
      // 注入的检索器可能直接抛，真实现不会 —— 两种都要接住
      const detail = e instanceof Error ? e.message : String(e);
      errors.push(detail);
      continue;
    }

    if (!outcome.ok) {
      errors.push(outcome.error);
      continue;
    }

    answeredCount += 1;
    for (const hit of outcome.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
  }

  return {
    report: {
      name: "arXiv",
      answered: answeredCount > 0,
      hitCount: hits.length,
      error: answeredCount > 0 ? "" : errors[0] ?? "arXiv 没有回话",
    },
    hits,
  };
}

type CrossrefBatch = {
  report: SourceReport;
  hits: CrossrefHit[];
};

/**
 * 查 Crossref。只发一个查询 —— 它吃自然语言，不需要多种拼法。
 */
async function searchCrossrefForClaim(
  query: string,
  searchers: Searchers,
): Promise<CrossrefBatch> {
  let outcome: CrossrefOutcome;
  try {
    outcome = await searchers.crossref(query);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      report: { name: "Crossref", answered: false, hitCount: 0, error: detail },
      hits: [],
    };
  }

  if (!outcome.ok) {
    return {
      report: { name: "Crossref", answered: false, hitCount: 0, error: outcome.error },
      hits: [],
    };
  }

  return {
    report: {
      name: "Crossref",
      answered: true,
      hitCount: outcome.hits.length,
      error: "",
    },
    hits: outcome.hits,
  };
}

/* ---------------------------------------------------------------
   3. 主函数
   --------------------------------------------------------------- */

/**
 * 查一条主张。
 *
 * 两个源**并发**发出去。为什么可以并发：
 * 它们在不同的域名上，各自的限速互不影响（arXiv 3 秒、Crossref 1 秒）。
 * 串行的话总时长就是两者之和，并发就是两者取最大。
 *
 * 用 Promise.allSettled 而不是 Promise.all：
 * allSettled 会等所有 promise 都有结果（无论成败）再返回，
 * 不会因为第一个失败就提前跳出。这正是降级需要的行为。
 */
export async function searchClaim(
  claim: Claim,
  intent: RetrievalQuery | null,
  searchers: Searchers = REAL_SEARCHERS,
): Promise<ClaimSearchOutcome> {
  const startedAt = Date.now();

  /*
     没有检索意图就没法查。
     注意这里返回的是 ok: false，而不是"查了 0 篇" ——
     翻译失败和查无结果是两件事，前者是流程坏了，后者是正常结论。
  */
  if (intent === null) {
    return { ok: false, error: "这条主张没翻出检索词，没法查" };
  }

  const arxivQueries = buildArxivQueries(intent, ARXIV_MODES);
  const crossrefQuery = buildCrossrefQuery(intent);

  /*
     allSettled 的返回值形如 [{status:"fulfilled",value},{status:"rejected",reason}]。
     我们两个子任务内部已经把异常转成 ok:false 了，所以正常情况下永远是 fulfilled，
     rejected 只会出现在注入的测试检索器上。
     但还是要处理 —— 不处理的话 destructure 会拿到 undefined。
  */
  const [arxivSettled, crossrefSettled] = await Promise.allSettled([
    searchArxivForClaim(arxivQueries, searchers),
    searchCrossrefForClaim(crossrefQuery, searchers),
  ]);

  const arxiv =
    arxivSettled.status === "fulfilled"
      ? arxivSettled.value
      : {
          report: {
            name: "arXiv" as const,
            answered: false,
            hitCount: 0,
            error: "arXiv 这一步整个炸了",
          },
          hits: [] as ArxivHit[],
        };

  const crossref =
    crossrefSettled.status === "fulfilled"
      ? crossrefSettled.value
      : {
          report: {
            name: "Crossref" as const,
            answered: false,
            hitCount: 0,
            error: "Crossref 这一步整个炸了",
          },
          hits: [] as CrossrefHit[],
        };

  const sources: SourceReport[] = [arxiv.report, crossref.report];
  const sourcesAnswered = sources.filter((source) => source.answered).length;

  const overlap = scoreOverlap({
    claim,
    intent,
    arxivHits: arxiv.hits,
    crossrefHits: crossref.hits,
    sourcesAnswered,
  });

  return {
    ok: true,
    data: {
      claimId: claim.id,
      trustworthy: sourcesAnswered > 0,
      overlap,
      sources,
      intent,
      rawHitCount: arxiv.hits.length + crossref.hits.length,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

/* ---------------------------------------------------------------
   4. 批量
   --------------------------------------------------------------- */

export type SearchAllOutcome = {
  /** claimId → 检索结果。没查成的条目不在这里 */
  byClaimId: Map<string, ClaimSearch>;
  /** 给人看的警告，一条一句 */
  warnings: string[];
  /** 有几个源答话了（所有主张里最差的那个值，用来判断整份报告可不可信） */
  minSourcesAnswered: number;
};

/**
 * 查一批主张。
 *
 * **串行**，不是并发。理由：
 * arXiv 的限速是**按账号（这里就是按 IP）算的**，模块级变量记上次请求时间。
 * 六条主张并发发出去，第一个请求把 lastRequestAt 更新掉，
 * 后面五个同时看到"刚查过，要等 3 秒"，然后一起等完 3 秒又一起发 —— 
 * 结果是六个请求同一秒打到 arXiv，五个被 429。
 * 串行才能让限速真正起作用。
 *
 * 代价是慢：6 条主张 × 3 个 arXiv 查询 × 3 秒 = 54 秒。
 * 这个代价是明知故犯的，先要正确，第 14 步之后再单独优化。
 */
export async function searchAllClaims(
  claims: Claim[],
  intents: RetrievalQuery[],
  searchers: Searchers = REAL_SEARCHERS,
): Promise<SearchAllOutcome> {
  const byClaimId = new Map<string, ClaimSearch>();
  const warnings: string[] = [];
  let minSourcesAnswered = Number.POSITIVE_INFINITY;

  const intentById = new Map(intents.map((intent) => [intent.claimId, intent]));

  for (const claim of claims) {
    const intent = intentById.get(claim.id) ?? null;
    const result = await searchClaim(claim, intent, searchers);

    if (!result.ok) {
      warnings.push(`「${shorten(claim.text)}」这条主张没查成：${result.error}`);
      // 没查成也算"0 个源答话"，不然它会凭空变成可信的 0 分
      minSourcesAnswered = Math.min(minSourcesAnswered, 0);
      continue;
    }

    byClaimId.set(claim.id, result.data);
    minSourcesAnswered = Math.min(
      minSourcesAnswered,
      result.data.sources.filter((source) => source.answered).length,
    );

    // 源挂了要单独说，而且要说清"是挂了不是没有"
    for (const source of result.data.sources) {
      if (!source.answered) {
        warnings.push(
          `「${shorten(claim.text)}」查 ${source.name} 时没成功（${source.error}），这条主张的分数只算了另一个库。`,
        );
      }
    }
  }

  return {
    byClaimId,
    warnings,
    minSourcesAnswered: Number.isFinite(minSourcesAnswered) ? minSourcesAnswered : 0,
  };
}

function shorten(text: string, max = 18): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
