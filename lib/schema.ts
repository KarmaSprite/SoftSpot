/**
 * 每层输出的 zod schema —— 运行时的"上锁"。
 *
 * 为什么需要这个文件：
 * lib/types.ts 里的类型只在写代码时存在，编译完就没了。
 * 模型返回的 JSON 是运行时的字符串，TypeScript 管不着它。
 * zod 干的就是在运行时检查"模型返回的东西到底是不是那个形状"，
 * 不对就当场报出人话错误，而不是让 undefined 一路传到界面上变成空白卡片。
 *
 * 三层各有一把锁：
 *   L1 抽取   → ExtractResultSchema（只出主张，不含分数）
 *   L2-A 检索 → RetrievalQuerySchema（中文主张 → 英文学术检索词）
 *   L2-B 质询 → QuestionSchema（问题 + 为什么问 + 3 条及格线）
 * 最后 L3 组装出来的成品 → AnalysisResultSchema
 */

import { z } from "zod";

/* ---------------------------------------------------------------
   0. 基础零件
   --------------------------------------------------------------- */

/** 非空文本：模型最容易犯的错就是返回空字符串，这里直接拦掉。 */
const NonEmptyText = z.string().trim().min(1);

/**
 * 0-100 的分数。
 *
 * 为什么不直接写 z.number().min(0).max(100)：
 * 模型经常返回 88.7、"88"、甚至 150。分数只影响图上一个点的位置，
 * 为这点小事让整次分析失败不划算，所以先转成数字再夹到 0-100 取整。
 * 但 "abc" 这种根本不是数字的，仍然拒绝 —— 那是模型真的坏了。
 */
export const ScoreSchema = z
  .preprocess((raw) => {
    if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
    return raw;
  }, z.number())
  .transform((n) => Math.min(100, Math.max(0, Math.round(n))));

/* ---------------------------------------------------------------
   1. L1 抽取：提纲文本 → 主张数组
   --------------------------------------------------------------- */

/** 主张只有三种类型，不要发明第四种。 */
export const ClaimTypeSchema = z.enum(["problem", "method", "expectation"]);

/** L1 直接吐出来的主张：还没有分数，分数要等 L2-A 检索完才算得出来。 */
export const RawClaimSchema = z.object({
  id: NonEmptyText,
  text: NonEmptyText,
  type: ClaimTypeSchema,
  location: NonEmptyText,
});

/** L1 的整包输出。上限 20 条，防止模型把整篇提纲按句号切开。 */
export const ExtractResultSchema = z.object({
  claims: z.array(RawClaimSchema).min(1).max(20),
});

/* ---------------------------------------------------------------
   2. 成品主张：L1 的主张 + L2-A 检索完算出来的两个分数
   --------------------------------------------------------------- */

export const ClaimSchema = RawClaimSchema.extend({
  overlap: ScoreSchema,
  defensibility: ScoreSchema,
});

/* ---------------------------------------------------------------
   3. L2-A 检索意图翻译：中文主张 → 英文学术检索词
   --------------------------------------------------------------- */

export const RetrievalQuerySchema = z.object({
  claimId: NonEmptyText,
  query: NonEmptyText,
  keywords: z.array(NonEmptyText).min(1).max(6),
});

export const RetrievalQueryListSchema = z.object({
  queries: z.array(RetrievalQuerySchema).min(1).max(20),
});

/* ---------------------------------------------------------------
   4. L2-B 质询生成：每条主张 1-2 个问题 + 及格线
   --------------------------------------------------------------- */

export const QuestionSchema = z.object({
  id: NonEmptyText,
  claimId: NonEmptyText,
  question: NonEmptyText,
  why: NonEmptyText,
  /**
   * 及格线固定 3 条。
   * 为什么写死：2 条显得敷衍，5 条用户记不住也做不到。
   * 3 条正好是"答辩老师会点头"的颗粒度。
   */
  checklist: z.array(NonEmptyText).length(3),
  risk: ScoreSchema,
});

/* ---------------------------------------------------------------
   5. L3 组装：一次分析的完整结果
   --------------------------------------------------------------- */

export const AnalysisResultSchema = z
  .object({
    claims: z.array(ClaimSchema).min(1).max(20),
    questions: z.array(QuestionSchema).min(1).max(40),
  })
  .superRefine((value, ctx) => {
    /**
     * 跨字段检查：每个问题的 claimId 必须能对上一条真实存在的主张。
     * 单字段校验查不出这个 —— 两个字段各自都合法，凑在一起却是孤儿。
     * 界面上如果出现一条"针对不存在的主张"的问题，用户会以为是自己贴错了。
     */
    const ids = new Set(value.claims.map((c) => c.id));
    value.questions.forEach((q, i) => {
      if (!ids.has(q.claimId)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "claimId"],
          message: `这条问题指向的主张 ${q.claimId} 不存在`,
        });
      }
    });
  });

/* ---------------------------------------------------------------
   6. 把 zod 的报错翻译成人话
   --------------------------------------------------------------- */

/**
 * zod 默认的报错是一整棵 JSON 树，人看不懂，日志里也翻不出来。
 * 这里压成一行一条，格式：字段路径: 原因
 * 例：claims.0.type: Invalid option: expected one of "problem"|"method"|"expectation"
 */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(根)"}: ${issue.message}`)
    .join("\n");
}

/* ---------------------------------------------------------------
   7. 从 schema 反推类型
   --------------------------------------------------------------- */

/**
 * 为什么从这里反推，而不是在 lib/types.ts 手写 interface：
 * 手写就是同一件事写两遍，迟早不一致。
 * 反推之后 schema 改一个字段，类型立刻跟着变，编译器会提醒你哪里要改。
 */
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export type RawClaim = z.infer<typeof RawClaimSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type ExtractResult = z.infer<typeof ExtractResultSchema>;
export type RetrievalQuery = z.infer<typeof RetrievalQuerySchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
