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
import {
  buildWebQuery,
  searchChinese,
  type WebHit,
  type WebSearchOutcome,
} from "./websearch.ts";
import type { Claim, RetrievalQuery } from "./schema.ts";

/* ---------------------------------------------------------------
   0. 类型
   --------------------------------------------------------------- */

/** 一个检索源的结局。ok 和 error 二选一，不存在"两者都没有"的中间态。 */
export type SourceReport = {
  /** 源的名字，用来写警告文案 */
  name: "arXiv" | "Crossref" | "中文网页";
  /** 这个源答话了吗 */
  answered: boolean;
  /** 答话时取回多少篇（去重前） */
  hitCount: number;
  /** 没答话时的人话原因 */
  error: string;
};

/**
 * 中文网页那一步的状态。
 *
 *   off     —— 英文库分数已经够高，没必要再花这个钱
 *   skipped —— 没配 key，主动跳过
 *   ok      —— 查了（含查到 0 条）
 *   failed  —— 配了 key 但查挂了
 *
 * 这四种必须分开：界面和警告文案完全不同。
 * 尤其 off 和 failed 不能混 —— 前者是我们自己决定的，后者是故障。
 */
export type WebStatus = "off" | "skipped" | "ok" | "failed";

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
  /** 中文网页那一步怎么了 */
  webStatus: WebStatus;
  /** 中文网页查回来几条（去重后） */
  webHitCount: number;
};

/** 一条主张的检索结局。整条失败只在"没有检索意图"时发生。 */
export type ClaimSearchOutcome =
  | { ok: true; data: ClaimSearch }
  | { ok: false; error: string };

/* ---------------------------------------------------------------
   1. 可注入的检索器
   --------------------------------------------------------------- */

/**
 * 检索函数做成可注入的参数。
 *
 * 这不是为了"架构好看"，是为了能测。
 * 降级逻辑最需要测的就是"源挂了会怎样"，而真让 arXiv 挂掉
 * 得等它自己超时（15 秒），测三个用例要等 45 秒，没人愿意跑。
 * 注入之后，一个返回 reject 的假函数就能模拟超时。
 *
 * 默认值就是真的那几个，生产代码不用传。
 */
export type Searchers = {
  arxiv: (query: string) => Promise<ArxivOutcome>;
  crossref: (query: string) => Promise<CrossrefOutcome>;
  /** 中文网页搜索。没配 key 时它自己会返回 skipped */
  web: (query: string) => Promise<WebSearchOutcome>;
};

export const REAL_SEARCHERS: Searchers = {
  arxiv: (query) => searchArxiv(query, { maxResults: 5 }),
  crossref: (query) => searchCrossref(query, { rows: 5 }),
  web: (query) => searchChinese(query),
};

/**
 * 什么情况下才去查中文网页。
 *
 * 设计意图：**只有英文库说「没查到什么」时才补查中文**。
 * 理由：arXiv 和 Crossref 已经说"撞车了"的主张，中文库再说一遍没有新信息，
 * 白白多花 0.005 元还多等一秒。
 * 而"没人做过"恰恰是最需要确认的结论 —— 中文职教论文根本不在英文库里，
 * 所以那个方向上最可能被中文库推翻。
 *
 * **这个数一开始写的是 25，实测发现等于永不触发，改成了 50。**
 *
 * 为什么 25 不行：25 在 buildReason 里对应「基本没人做过」那一档。
 * 但真跑三份提纲（直播带货 / 面点默会知识 / 镜头语言）共 23 条主张，
 * 英文库的分数下限是 **41**，没有一条低于 25。
 * 原因是分数公式里「高职」「教学」「学生」这类通用词总会撞上，
 * 40 分左右是这套算法的地板，不是"查不到"。
 *
 * 为什么 50 对：50 是「有重合」那条线。低于 50 意味着英文库连"沾边"都算不上，
 * 那才是真的该拿中文库复核一下。实测这个阈值会触发 1-2 条（8 条主张里），
 * 多花 0.005-0.01 元、多等 1-2 秒，可以接受。
 *
 * 这个数改了会直接影响花多少钱和等多久。
 */
export const WEB_RETRY_THRESHOLD = 50;

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
 * **两阶段**：
 *
 * 阶段一 —— arXiv 和 Crossref **并发**发出去。
 *   为什么可以并发：它们在不同的域名上，各自的限速互不影响
 *   （arXiv 3 秒、Crossref 1 秒）。串行的话总时长就是两者之和，
 *   并发就是两者取最大。
 *
 * 阶段二 —— 只有在阶段一给出「基本没人做过」时才去查中文网页。
 *   为什么不无条件查：8 条主张每条都查，一次分析多花 0.04 元、多等十几秒，
 *   而英文库已经说"撞车了"的那些，中文库再说一遍没有任何新信息。
 *   反过来，「没人做过」恰恰是最需要确认的结论 ——
 *   中文职教论文根本不在英文库里，那个方向上最容易被中文库推翻。
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

  /*
     先算一次只有英文库的分数。
     这个分数有两个用途：一是决定要不要补查中文，二是万一中文没查成时的最终结果。
  */
  const englishOnly = scoreOverlap({
    claim,
    intent,
    arxivHits: arxiv.hits,
    crossrefHits: crossref.hits,
    sourcesAnswered,
  });

  let webHits: WebHit[] = [];
  let webStatus: WebStatus = "off";

  if (englishOnly.score < WEB_RETRY_THRESHOLD) {
    const webQuery = buildWebQuery(intent);
    let webOutcome: WebSearchOutcome | null = null;

    try {
      webOutcome = await searchers.web(webQuery);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      webOutcome = { ok: false, error: `中文网页这一步整个炸了：${detail}`, skipped: false };
    }

    if (webOutcome === null) {
      webStatus = "failed";
    } else if (!webOutcome.ok) {
      webStatus = webOutcome.skipped ? "skipped" : "failed";
      if (!webOutcome.skipped) {
        sources.push({
          name: "中文网页",
          answered: false,
          hitCount: 0,
          error: webOutcome.error,
        });
      }
    } else {
      webStatus = "ok";
      webHits = webOutcome.hits;
      sources.push({
        name: "中文网页",
        answered: true,
        hitCount: webOutcome.hits.length,
        error: "",
      });
    }
  }

  /*
     中文网页不计入 sourcesAnswered —— 它是加餐，不是主判定。
     换句话说：arXiv 和 Crossref 都挂了、中文查到了三篇，
     这条主张的分数仍然标成"不可信"。
     理由：中文网页是模糊检索，单靠它一个撑不起"别人做过吗"这个结论；
     而英文库全军覆没本身就是个需要用户知道的故障。
  */
  const overlap =
    webHits.length > 0
      ? scoreOverlap({
          claim,
          intent,
          arxivHits: arxiv.hits,
          crossrefHits: crossref.hits,
          webHits,
          sourcesAnswered,
        })
      : englishOnly;

  return {
    ok: true,
    data: {
      claimId: claim.id,
      trustworthy: sourcesAnswered > 0,
      overlap,
      sources,
      intent,
      rawHitCount: arxiv.hits.length + crossref.hits.length + webHits.length,
      elapsedMs: Date.now() - startedAt,
      webStatus,
      webHitCount: webHits.length,
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
  /** 补查中文网页一共发了几次请求 —— 用来算钱（0.005 元/次） */
  webSearchCalls: number;
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
  let webSearchCalls = 0;

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

    /*
       补查中文发了几次请求。
       "off" 表示分数够高、没查，不算钱；
       其余三种（skipped / ok / failed）都是真发出去过或尝试过。
       注意 skipped 是没配 key，请求根本没发出去 —— 所以只有 ok 和 failed 才计费。
    */
    if (result.data.webStatus === "ok" || result.data.webStatus === "failed") {
      webSearchCalls += 1;
    }

    byClaimId.set(claim.id, result.data);
    minSourcesAnswered = Math.min(
      minSourcesAnswered,
      /*
         只数 arXiv 和 Crossref。
         中文网页是加餐，它答话了不代表"主判定"有据 ——
         这条跟 searchClaim 里 trustworthy 的口径必须一致，
         否则会出现"报告说可信、但 minSourcesAnswered 说 3 个源"这种自相矛盾。
      */
      result.data.sources.filter((source) => source.answered && source.name !== "中文网页").length,
    );

    /*
       源挂了要单独说，而且要说清"是挂了不是没有"。
       中文网页的失败文案不一样：它是加餐，挂了不该让人以为报告不可信，
       所以只说"这次没补上中文"，不说"只算了另一个库"。
    */
    for (const source of result.data.sources) {
      if (source.answered) continue;

      if (source.name === "中文网页") {
        warnings.push(
          `「${shorten(claim.text)}」补查中文文献时没成功（${source.error}）。英文库的分数照常算，只是少了一个参考。`,
        );
        continue;
      }

      warnings.push(
        `「${shorten(claim.text)}」查 ${source.name} 时没成功（${source.error}），这条主张的分数只算了另一个库。`,
      );
    }
  }

  return {
    byClaimId,
    warnings,
    minSourcesAnswered: Number.isFinite(minSourcesAnswered) ? minSourcesAnswered : 0,
    webSearchCalls,
  };
}

function shorten(text: string, max = 18): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
