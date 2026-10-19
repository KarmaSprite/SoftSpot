/**
 * 危险等级的换算规则 —— 纯代码，不调模型。
 *
 * 为什么分数不直接让模型给：
 * 让模型打 0-100 分，同一条主张跑两次能给 92 和 78 两个数。
 * 而且模型给自己刚生成的问题打分，天然会往高里打 ——
 * 它刚说完"这个问题很关键"，再给个低分等于自我否定。
 *
 * 所以拆成两件事：
 *   模型只判断"危险等级"（fatal / high / medium / low / minor）—— 这是语义判断，它擅长
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
 * 五档对应的底分。
 *
 * **为什么从三档改成五档** —— 这是真跑两份提纲撞出来的问题。
 *
 * 三档时（85 / 60 / 35）模型几乎只用 high 和 medium，
 * 一条主张的两个问题总是 [85, 60]，七条主张算出来的稳度全是同一个数，
 * 四象限图的纵轴变成一条水平线，整张图只有横轴在动。
 *
 * 五档之后模型有地方表达"这条比那条更危险"，纵轴才动得起来。
 *
 * **为什么档位间距不均匀（20 / 15 / 15 / 10）**：
 * 上面两档要拉得开，因为"会换题"和"会被追到底"是性质差别，
 * 用户看报告时最先要区分的就是这两种。下面两档靠得近，
 * 因为"较低"和"轻微"本来就没什么区别，分太开反而像在编。
 *
 * 最小值 20 而不是 0：没有任何问题真的"完全没风险"，
 * 0 分出现在排序里会让人以为那条问题坏了。
 */
export const LEVEL_BASE: Record<RiskLevel, number> = {
  fatal: 95,
  high: 75,
  medium: 55,
  low: 35,
  minor: 20,
};

/** 五档在界面上的中文名。放在底分旁边，改档位时不会漏改文案。 */
export const LEVEL_LABEL: Record<RiskLevel, string> = {
  fatal: "致命",
  high: "高危",
  medium: "中等",
  low: "较低",
  minor: "轻微",
};

/* ---------------------------------------------------------------
   2. 修正项
   --------------------------------------------------------------- */

/**
 * 修正项的意义：同一条主张，如果它本身"答得上来"分就低，
 * 说明作者对这个方向本来就没底，被问到会更危险。
 *
 * 修正幅度必须小于最小档位间距，否则低档加满会顶到上一档头上，排序就乱。
 * 现在五档底分是 95 / 75 / 55 / 35 / 20，最小间距 15，
 * 而所有修正加起来最多 13 —— 差 2 分，安全但很窄。
 *
 * 所以下面 computeRisk 里还加了一道 cap 兜底：
 * 就算以后有人调大了修正值，也不会跨档。
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
 * 档位从高到低的顺序，用来找"上一档的底分"。
 * 写成数组而不是靠对象 key 顺序，因为对象 key 顺序不保证。
 */
const LEVEL_ORDER: RiskLevel[] = ["fatal", "high", "medium", "low", "minor"];

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

  /*
     关键一步：修正之后不许跨档。
     两个修正加起来最多 13 分，而最小档位间距只有 10 分 ——
     不拦的话 medium 加满（55+13=68）会顶到 high 的底分（75）以下但
     超过 low 的上一档，排序就乱了。

     具体做法：把分数夹在 [本档底分, 上一档底分 - 1] 之间。
     fatal 是最高的档，上一档不存在，用 RISK_MAX 兜住。
  */
  const rank = LEVEL_ORDER.indexOf(level);
  const upper = rank === 0 ? RISK_MAX + 1 : LEVEL_BASE[LEVEL_ORDER[rank - 1]];
  const cap = upper - 1;

  const clamped = Math.min(RISK_MAX, Math.max(RISK_MIN, Math.round(Math.min(score, cap))));

  if (clamped !== score) {
    parts.push(`夹到 ${RISK_MIN}-${cap} 之间，得 ${clamped}`);
  }

  return { score: clamped, reason: parts.join("；") };
}
