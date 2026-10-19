/**
 * POST /api/analyze —— 一次完整的分析：提纲 → 主张 → 质询问题。
 *
 * 这一步（5b）只做"串起来"和"看得见"，不做检索打分。
 * 所以主张的 overlap / defensibility 先统一填 50，
 * 并在响应里带 scoresArePlaceholder: true 明说这是占位值。
 *
 * 为什么要显式标出来，而不是默默填 50：
 * 第 12 步才做真正的二维打分。如果现在不标记，
 * 前端会把 50 当成"真的查过了"，等第 12 步换成真分数时，
 * 你会以为"分数怎么突然变了，是不是有 bug"。
 * 占位值必须自己承认自己是占位值。
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
import { generateQuestions } from "@/lib/question";
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
 * 占位分数。
 *
 * 为什么是 50 而不是 0 或 100：
 *   1. 50 正好在四象限分界线上。lib/quadrant.ts 里 >= 50 算"高"侧，
 *      所以 50 会被判成"有人做过 + 答得上来"（crowded）。
 *      这个位置最中性 —— 它不假装自己很新，也不假装自己很稳。
 *   2. lib/risk.ts 里 LOW_DEFENSIBILITY_THRESHOLD 也是 50，
 *      而判断用的是 < 50，所以 50 不会额外加 8 分惩罚。
 *      换成 49 就会让所有问题的风险分虚高。
 */
const PLACEHOLDER_SCORE = 50;

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

  /**
   * 把 L1 的 RawClaim 补成带分数的 Claim。
   *
   * 注意这里的 id 原样保留 —— 后面质询要按 id 关联。
   * 如果这里重新编号，模型给的问题就会指向不存在的主张。
   */
  const claims: Claim[] = extracted.data.claims.map((raw) => ({
    ...raw,
    overlap: PLACEHOLDER_SCORE,
    defensibility: PLACEHOLDER_SCORE,
  }));

  /* ---------- L2-B：质询 ---------- */

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
   * 所以下面加了一条自检：真漏了会在 warnings 里多一句提示。
   */
  const warnedClaimIds = new Set<string>();
  for (const w of extracted.warnings) {
    const m = w.match(/（([^）]+)）/);
    if (m) warnedClaimIds.add(m[1]);
  }

  const questioned = await generateQuestions(claims, outline, client.call, {
    warnedClaimIds,
  });
  if (!questioned.ok) {
    return NextResponse.json({ error: questioned.error }, { status: 422 });
  }

  warnings.push(...questioned.warnings);

  /* ---------- L3：组装 + 自检 ---------- */

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

  return NextResponse.json({
    claims: assembled.data.claims,
    questions: assembled.data.questions,
    warnings,
    usage,
    /** 估算花费（元）。只是估算，不含缓存折扣，会比真实账单略高一点。 */
    costYuan: estimateCost(usage),
    model: DEFAULT_MODEL,
    /** 明说分数是占位的，第 12 步才会换成真分数。 */
    scoresArePlaceholder: true,
    elapsedMs: Date.now() - startedAt,
  });
}
