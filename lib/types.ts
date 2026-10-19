/**
 * 全项目共用的数据结构 —— 对外只认这一个入口。
 *
 * 为什么这里不再手写 interface：
 * 之前 Claim / Question 在这里手写一遍，schema 里再写一遍，同一件事写两遍，
 * 迟早不一致。现在真正的定义在 lib/schema.ts（zod），这里只做两件事：
 *   1. 把类型转出来，别处一律 `import type { Claim } from "@/lib/types"`
 *   2. 放纯常量（界面文案之类，跟校验无关的东西）
 *
 * 这样改字段只有一个地方要动：lib/schema.ts。
 */

import type { ClaimType } from "./schema";

export type {
  ClaimType,
  RawClaim,
  Claim,
  RiskLevel,
  RawQuestion,
  Question,
  ExtractResult,
  RetrievalQuery,
  AnalysisResult,
} from "./schema";

/* ---------------------------------------------------------------
   界面文案：跟校验无关，所以留在这里
   --------------------------------------------------------------- */

/** 三种类型在界面上的中文名。 */
export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  problem: "问题",
  method: "方法",
  expectation: "预期",
};
