/**
 * POST /api/analyze —— 一次完整的分析：提纲 → 主张 → 质询问题 → 检索打分。
 *
 * 第 13 步把三件事接进来了：L2-A 检索意图翻译、arXiv 和 Crossref 真检索、
 * 以及把检索结果算成「别人做过吗」的分数。
 *
 * 这一步最关键的设计不是"怎么查"，是**怎么在查不到的时候不说谎**。
 *
 * 三种情况必须分开：
 *   1. 查了，一篇都没有       → 分数 0，这是有效结论（可能真的很新）
 *   2. 查了，但那个库没答话   → 分数不可信，要标出来
 *   3. 一个库都没答话         → 分数不可信，而且要在报告顶上明说
 *
 * 混成一种，用户就会把"我不知道"读成"没人做过"。
 * 这个产品的全部价值建立在"分数是可信的"上面，一旦开始编，
 * 它跟那些到答辩前才告诉你重复的查重工具就没区别了。
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createModelClient,
  estimateCost,
  DEFAULT_MODEL,
  type Usage,
} from "@/lib/deepseek";
import { extractClaims } from "@/lib/extract";
import { blendDefensibility, evidenceOf, type EvidenceResult } from "@/lib/evidence";
import { generateQuestions } from "@/lib/question";
import { translateClaims } from "@/lib/retrieval";
import { searchAllClaims } from "@/lib/search";
import { estimateSearchCost, isWebSearchConfigured } from "@/lib/websearch";
import { defensibilityFromRisk } from "@/lib/similarity";
import { AnalysisResultSchema, formatIssues } from "@/lib/schema";
import type { Claim, Question } from "@/lib/types";

/* ---------------------------------------------------------------
   1. 入参校验
   --------------------------------------------------------------- */

const BodySchema = z.object({
  /**
   * 只校验"是不是非空字符串"，长度上下限交给 lib/extract.ts。
   * 为什么：那边的上限是 MAX_OUTLINE_LENGTH = 8000，
   * 如果这里再写一遍 8000，以后改上限就得改两个地方，迟早忘一个。
   * 一件事只在一个地方定义。
   */
  outline: z.string(),
});

/**
 * 没被质询过的主张，可辩护度给多少。
 *
 * 为什么是 50 而不是 100：
 * 100 等于说"这条你完全答得上来"，但我们根本没问过它。
 * 50 是"不知道"，落在四象限分界线上，图上不会把它推到"你的主场"里去 ——
 * 把没问过的东西算成优势，比算成劣势危险得多。
 *
 * 为什么不是 0：0 等于说"这条你肯定答不上来"，同样是编。
 *
 * 这个常数和 lib/similarity.ts 里 defensibilityFromRisk 对空数组的处理
 * 是同一个值、同一个理由 —— 那边是"没被质询过 ≠ 没问题"。
 */
const UNQUESTIONED_DEFENSIBILITY = 50;

/* ---------------------------------------------------------------
   2. 主处理
   --------------------------------------------------------------- */

export async function POST(request: Request) {
  const startedAt = Date.now();

  /**
   * key 检查放在最前面。
   *
   * 为什么值得单独一段：没配 key 时，调模型会拿到 401，
   * 用户看到的是"Authentication Fails"这种英文报错，
   * 得自己想到"哦我好像没配 key"。
   * 在这里提前拦住，就能直接告诉他去改哪个文件。
   *
   * 而且这一步不花钱、不联网，失败也快。
   */
  const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (apiKey === "") {
    return NextResponse.json(
      {
        error:
          "还没配 DEEPSEEK_API_KEY。在 pre-defense 目录下新建 .env.local，写一行 DEEPSEEK_API_KEY=sk-你的key，保存后不用重启。",
      },
      { status: 400 },
    );
  }

  /* ---------- 读请求体 ---------- */

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const parsedBody = BodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: `请求格式不对：\n${formatIssues(parsedBody.error)}` },
      { status: 400 },
    );
  }

  const outline = parsedBody.data.outline.trim();
  if (outline === "") {
    return NextResponse.json({ error: "提纲是空的，先贴点内容进来。" }, { status: 400 });
  }

  /* ---------- 造模型客户端 ---------- */

  const client = createModelClient({ apiKey });

  /* ---------- L1：抽主张 ---------- */

  const extracted = await extractClaims(outline, client.call);
  if (!extracted.ok) {
    return NextResponse.json({ error: extracted.error }, { status: 422 });
  }

  const warnings: string[] = [...extracted.warnings];

  const rawClaims = extracted.data.claims;

  /**
   * L1 返回的是 RawClaim（没有分数），但质询和检索的签名要 Claim。
   * 这里先套一层临时分数 50/50，纯粹为了让类型对上。
   *
   * 为什么是 50：它在四象限分界线上，任何地方都不会被读成"确定的高"或"确定的低"。
   * 这层临时值**不会出现在最终响应里** —— 下面 L3 组装时会整个覆盖掉。
   *
   * 注意 id 原样保留：后面质询要按 id 关联检索结果，
   * 重新编号会让所有关联断掉。
   */
  const stagedClaims: Claim[] = rawClaims.map((raw) => ({
    ...raw,
    overlap: UNQUESTIONED_DEFENSIBILITY,
    defensibility: UNQUESTIONED_DEFENSIBILITY,
  }));

  /* ---------- L2-A：翻译检索意图 ---------- */

  /*
     为什么翻译要单独等，不跟后面的质询并发：
     检索依赖翻译结果（没有英文术语就没法查 arXiv），
     而质询不依赖翻译。所以顺序必须是
       翻译 → 然后「质询」和「检索」并发。
     反过来的话，检索会拿到空数组，所有分数都变成 0。

     这一步是 9 次模型调用（每条主张一次），实测 20 秒上下。
  */
  const translated = await translateClaims(stagedClaims, outline, client.call);
  if (!translated.ok) {
    return NextResponse.json({ error: translated.error }, { status: 422 });
  }
  warnings.push(...translated.warnings);

  /* ---------- 质询 + 检索，并发 ---------- */

  /**
   * warnedClaimIds 从 L1 的警告里还原出来。
   *
   * 为什么绕这一圈：lib/question.ts 需要知道"哪条主张的原文对不上"，
   * 好给它的问题加 5 分风险（原文都对不上，说明作者对这条本来就没底）。
   * 但 L1 返回的是给人看的警告文案，不是 id 列表。
   *
   * 从文案里用正则抠 id 有点脏，但比改 L1 的返回类型干净 ——
   * 改类型要动 extract.ts、它的 18 个测试、还有将来的调用方。
   * 这里用 "（c1）" 这个格式去匹配，格式在 extract.ts 里是写死的，
   * 如果那边改了格式，这里会静默失效（不报错，只是少加 5 分）。
   */
  const warnedClaimIds = new Set<string>();
  for (const w of extracted.warnings) {
    const m = w.match(/（([^）]+)）/);
    if (m) warnedClaimIds.add(m[1]);
  }

  /*
     质询和检索互不依赖，所以并发。
     为什么不三个（含翻译）一起并发：检索要用翻译的产出，这是真依赖。

     并发的收益是实测过的：质询 30 秒、检索 27 秒，
     串行 57 秒，并发取最大 30 秒。总时长从 80 秒压到 55 秒左右。
  */
  const [questioned, searched] = await Promise.all([
    generateQuestions(stagedClaims, outline, client.call, { warnedClaimIds }),
    searchAllClaims(stagedClaims, translated.data),
  ]);

  if (!questioned.ok) {
    return NextResponse.json({ error: questioned.error }, { status: 422 });
  }
  warnings.push(...questioned.warnings);
  warnings.push(...searched.warnings);

  /* ---------- L3：组装分数 ---------- */

  /**
   * 纵轴 = 校准后的证据分 + 问题压力微调（最多 ±15 分）。
   *
   * 为什么不是「100 - 最危险那个问题」：
   * 那个算法真跑两份提纲都得到同一个数（八条主张全是 15 / 全 19），
   * 八个点压在同一条水平线上，四象限图退化成只有横轴在动。
   * 原因是质询引擎对任何一条主张都会问出「你有数据吗」「怎么排除班级差异」
   * 这类致命问题 —— 这是它的本职，所以危险度天然没有区分度。
   *
   * 现在的纵轴主要看「提纲自己撑不撑得住这条主张」（lib/evidence.ts，纯代码数
   * 数字/方法词/出处/具体程度），问题压力只做上下微调。
   * 推导过程（含为什么不是 0.6/0.4 加权）写在 lib/evidence.ts 的注释里。
   */
  const risksByClaim = new Map<string, number[]>();
  for (const question of questioned.data) {
    const list = risksByClaim.get(question.claimId);
    if (list) {
      list.push(question.risk);
    } else {
      risksByClaim.set(question.claimId, [question.risk]);
    }
  }

  /**
   * 检索没查成的主张。
   *
   * 这些主张的 overlap 会填 0（lib/overlap.ts 在 sourcesAnswered = 0 时就是这么返回的），
   * 但 0 分在图上落在最左边，读起来是"没人做过"——那是在说谎。
   * 所以这里单独记一份名单，前端要把这些点画成"不知道"的样子，
   * 而不是画成一个确定的 0 分。
   */
  const blindClaimIds: string[] = [];

  /** 每条主张的证据分明细，前端要显示「这个分是怎么来的」。 */
  const evidenceById = new Map<string, EvidenceResult>();

  const claims: Claim[] = rawClaims.map((raw) => {
    const risk = risksByClaim.get(raw.id) ?? [];
    const pressure =
      risk.length === 0 ? UNQUESTIONED_DEFENSIBILITY : defensibilityFromRisk(risk);

    const evidence = evidenceOf(raw as Claim);
    evidenceById.set(raw.id, evidence);
    const defensibility = blendDefensibility(evidence.score, pressure);

    const found = searched.byClaimId.get(raw.id);
    if (!found || !found.trustworthy) {
      blindClaimIds.push(raw.id);
      return {
        ...raw,
        overlap: found?.overlap.score ?? 0,
        defensibility,
      };
    }

    return {
      ...raw,
      overlap: found.overlap.score,
      defensibility,
    };
  });

  /* ---------- L3：自检 ---------- */

  const questions: Question[] = questioned.data;

  /**
   * 最后用 AnalysisResultSchema 整体过一遍。
   *
   * 前面每层都各自校验过了，为什么还要再校验一次：
   * 前两层校验的是"各自那一层合不合格"，
   * 而这里校验的是"拼起来还成不成立"——
   * 比如某个问题的 claimId 指向一条已经被过滤掉的主张。
   * 这种错只有在拼完之后才看得出来。
   *
   * 如果这一步挂了，说明是我们自己的代码有 bug，不是模型的问题，
   * 所以返回 500 并在文案里明说，免得用户去怪模型。
   */
  const assembled = AnalysisResultSchema.safeParse({ claims, questions });
  if (!assembled.success) {
    return NextResponse.json(
      {
        error: `报告组装失败，这是程序的问题不是模型的问题：\n${formatIssues(assembled.error)}`,
      },
      { status: 500 },
    );
  }

  /* ---------- 返回 ---------- */

  const usage: Usage = client.getUsage();
  const webSearchCost = estimateSearchCost(searched.webSearchCalls);

  return NextResponse.json({
    claims: assembled.data.claims,
    questions: assembled.data.questions,
    warnings,
    usage,
    /** 估算花费（元）。只是估算，不含缓存折扣，会比真实账单略高一点。 */
    costYuan: estimateCost(usage),
    /**
     * 中文网页搜索的钱，单独记。
     *
     * 为什么分开：它按次计费（5 元/千次），跟 token 完全不是一个计价方式。
     * 混进 costYuan 里，用户就分不清"模型贵还是搜索贵"。
     */
    webSearchCalls: searched.webSearchCalls,
    webSearchCostYuan: webSearchCost,
    /** 总花费 = 模型 + 搜索。界面上直接显示这一个数。 */
    totalCostYuan: Math.round((estimateCost(usage) + webSearchCost) * 10_000) / 10_000,
    /** 这次有没有配 key、能不能补中文。没配时界面要说清"这次没查中文库"。 */
    webSearchEnabled: isWebSearchConfigured(),
    model: DEFAULT_MODEL,
    /** 分数这次是真算的，不是占位值了。 */
    scoresArePlaceholder: false,
    /**
     * 哪些主张的分数不可信（一个数据库都没查成）。
     * 前端要把这些点画成"不知道"，不能画成一个确定的低分。
     */
    blindClaimIds,
    /** 每个主张的检索证据，界面上可以展开看"最像的是哪一篇"。 */
    search: [...searched.byClaimId.values()].map((item) => ({
      claimId: item.claimId,
      trustworthy: item.trustworthy,
      score: item.overlap.score,
      reason: item.overlap.reason,
      totalHits: item.overlap.totalHits,
      sources: item.sources,
      bestHit: item.overlap.bestHit,
      /**
       * 中文网页那一步怎么了。
       * off = 英文库分数够高，没花这个钱；skipped = 没配 key；
       * ok = 查了；failed = 查挂了。
       * 界面要能分清这四种，尤其 off 和 failed 不能都说成"没查中文"。
       */
      webStatus: item.webStatus,
      webHitCount: item.webHitCount,
    })),
    /**
     * 纵轴分数的明细。
     *
     * 为什么要返回这个：纵轴现在主要看「提纲自己有没有证据」，
     * 用户看到一条主张是 37 分，一定会问"为什么"。
     * 把四个维度命中什么、各给多少分一起送回去，界面直接摊开给他看 ——
     * 诊断类产品如果给不出理由，用户只会觉得是玄学。
     */
    evidence: [...evidenceById.entries()].map(([claimId, result]) => ({
      claimId,
      score: result.score,
      reason: result.reason,
      dimensions: result.dimensions,
    })),
    /** 有几个源答话了（全部主张里最差的那个），0 表示整份报告的分数都不可信。 */
    minSourcesAnswered: searched.minSourcesAnswered,
    elapsedMs: Date.now() - startedAt,
  });
}
