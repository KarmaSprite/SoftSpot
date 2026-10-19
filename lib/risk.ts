/**
 * 危险等级的换算规则 —— 纯代码，不调模型。
 *
 * 为什么分数不直接让模型给：
 * 让模型打 0-100 分，同一条主张跑两次能给 92 和 78 两个数。
 * 而且模型给自己刚生成的问题打分，天然会往高里打 ——
 * 它刚说完"这个问题很关键"，再给个低分等于自我否定。
 *
 * 所以拆成两件事：
 *   模型只判断"危险等级"（high / medium / low）—— 这是语义判断，它擅长
 *   代码负责把等级换算成分数 —— 这是算术，代码永远一样
 *
 * 这也是四象限那条规则的延伸：能让代码算的，就别让模型算。
 * 答辩被问"这个 92 分怎么来的"，能直接指着这个文件回答。
 */

import type { RiskLevel } from "./schema.ts";

/* ---------------------------------------------------------------
   1. 底分
   --------------------------------------------------------------- */

/**
 * 三档对应的底分。
 *
 * 为什么不是 100/66/33：
 * 那种写法看起来像"均匀分布"，但 100 分意味着"绝对答不上来"，
 * 是个断言。留一点余地更诚实 —— 而且界面上出现满分红条看着太凶。
 *
 * 为什么三档之间拉开 25 分：
 * 差距太小（比如 80/75/70）就失去意义了，用户看不出排序。
 * 拉开之后，high 的问题一定排在 medium 前面，不会被纯代码的
 * 修正项（最多 +13）跨档反超。
 */
export const LEVEL_BASE: Record<RiskLevel, number> = {
  high: 85,
  medium: 60,
  low: 35,
};

/** 三档在界面上的中文名。放在底分旁边，改档位时不会漏改文案。 */
export const LEVEL_LABEL: Record<RiskLevel, string> = {
  high: "高危",
  medium: "中等",
  low: "较低",
};

/* ---------------------------------------------------------------
   2. 修正项
   --------------------------------------------------------------- */

/**
 * 修正项的意义：同一条主张，如果它本身"答得上来"分就低，
 * 说明作者对这个方向本来就没底，被问到会更危险。
 *
 * 但修正幅度必须小于档位间距（25 分），
 * 否则 medium 加满分会顶到 high 的头上，排序就乱了。
 * 这里所有修正加起来最多 13 分，安全。
 */
export const PENALTY_LOW_DEFENSIBILITY = 8;
export const PENALTY_HAS_WARNING = 5;

/** 这条主张的"答得上来"分低于多少算没底。和四象限用的是同一个 50。 */
export const LOW_DEFENSIBILITY_THRESHOLD = 50;

export const RISK_MIN = 5;
export const RISK_MAX = 99;

/* ---------------------------------------------------------------
   3. 主函数
   --------------------------------------------------------------- */

export type RiskContext = {
  /** 这条主张的"答得上来"分数（0-100）。 */
  defensibility: number;
  /** 这条主张在原文核对时有没有被警告（模型可能改写了措辞）。 */
  hasWarning: boolean;
};

export type RiskResult = {
  score: number;
  /** 一句话说明这个分数怎么来的，直接显示在卡片上。 */
  reason: string;
};

/**
 * 把危险等级换算成 0-100 的分数。
 *
 * 返回 reason 是为了让分数可解释 —— 答辩被问"这个 92 怎么算的"，
 * 把这句话念出来就是答案。诊断类产品如果给不出理由，
 * 用户只会觉得是玄学。
 */
export function computeRisk(level: RiskLevel, context: RiskContext): RiskResult {
  const base = LEVEL_BASE[level];
  const parts: string[] = [`模型判断为${LEVEL_LABEL[level]}，底分 ${base}`];

  let score = base;

  if (context.defensibility < LOW_DEFENSIBILITY_THRESHOLD) {
    score += PENALTY_LOW_DEFENSIBILITY;
    parts.push(`这条主张本身答得上来只有 ${context.defensibility} 分，加 ${PENALTY_LOW_DEFENSIBILITY}`);
  }

  if (context.hasWarning) {
    score += PENALTY_HAS_WARNING;
    parts.push(`主张原文在提纲里对不上，加 ${PENALTY_HAS_WARNING}`);
  }

  const clamped = Math.min(RISK_MAX, Math.max(RISK_MIN, Math.round(score)));
  if (clamped !== score) {
    parts.push(`夹到 ${RISK_MIN}-${RISK_MAX} 之间，得 ${clamped}`);
  }

  return { score: clamped, reason: parts.join("；") };
}
