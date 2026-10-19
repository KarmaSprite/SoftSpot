/**
 * 四象限计算。纯函数，不调模型，不读环境变量。
 *
 * 为什么不用模型算：
 * 同一个输入，模型两次能给两个答案；代码算永远一样。
 * 答辩时被问「这个点为什么在这个角」，能指着这两行代码回答。
 */

import type { Claim } from "./types";

/* ---------------------------------------------------------------
   1. 象限定义
   --------------------------------------------------------------- */

/**
 * 四个象限。命名按「对用户的意义」而不是按坐标，
 * 因为界面上要直接把这些词显示给用户看。
 *
 *   overlap 高 = 别人做过；overlap 低 = 新
 *   defensibility 高 = 你答得上来；低 = 答不上来
 */
export type Quadrant =
  /** 又新又答得上来 —— 你的主场，唯一值得保留的角 */
  | "home"
  /** 别人做过，但你还答得上来 —— 可以做，得说清差异 */
  | "crowded"
  /** 又新又答不上来 —— 想法好但你自己没想清楚 */
  | "foggy"
  /** 别人做过，你也答不上来 —— 最该改的地方 */
  | "weak";

/** 象限的中文名和一句话解释，界面直接用。 */
export const QUADRANT_META: Record<
  Quadrant,
  { label: string; hint: string }
> = {
  home: {
    label: "你的主场",
    hint: "又新又答得上来，这是你答辩时最有底气的地方",
  },
  crowded: {
    label: "有人做过了",
    hint: "别人做过，但你答得上来，说清你和他们的差别就行",
  },
  foggy: {
    label: "没想清楚",
    hint: "想法是新的，但你自己还没想明白，容易被追问穿",
  },
  weak: {
    label: "最该改的地方",
    hint: "别人做过，你又答不上来，这一条最危险",
  },
};

/* ---------------------------------------------------------------
   2. 分界线
   --------------------------------------------------------------- */

/**
 * 四象限分界，写死 50 分，不做成滑块。
 *
 * 为什么不做滑块：做成滑块，用户会一直拖到自己满意为止，
 * 那这张图就失去诊断意义了。分界固定，才有「客观判你」的感觉。
 */
export const QUADRANT_THRESHOLD = 50;

/* ---------------------------------------------------------------
   3. 核心函数
   --------------------------------------------------------------- */

/**
 * 判断一条主张落在哪个象限。
 *
 * 边界规则：正好 50 分算「高」这一侧。
 * 也就是说 50 分算「别人做过」、算「你答得上来」。
 * 这条规则写死在下面的 >= 里，别处不要再写第二份。
 */
export function getQuadrant(
  overlap: number,
  defensibility: number
): Quadrant {
  const isCrowded = overlap >= QUADRANT_THRESHOLD;
  const isSolid = defensibility >= QUADRANT_THRESHOLD;

  if (isSolid && !isCrowded) return "home";
  if (isSolid && isCrowded) return "crowded";
  if (!isSolid && !isCrowded) return "foggy";
  return "weak";
}

/** 给一条主张判断象限，只是把字段取出来。 */
export function getClaimQuadrant(claim: Claim): Quadrant {
  return getQuadrant(claim.overlap, claim.defensibility);
}

/* ---------------------------------------------------------------
   4. 分组
   --------------------------------------------------------------- */

/** 四个象限，按「危险程度从高到低」排，界面上按这个顺序展示。 */
export const QUADRANT_ORDER: Quadrant[] = [
  "weak",
  "foggy",
  "crowded",
  "home",
];

/** 把主张按象限分组，空象限也保留一个空数组，方便界面统一渲染。 */
export function groupByQuadrant(claims: Claim[]): Record<Quadrant, Claim[]> {
  const groups: Record<Quadrant, Claim[]> = {
    weak: [],
    foggy: [],
    crowded: [],
    home: [],
  };

  for (const claim of claims) {
    groups[getClaimQuadrant(claim)].push(claim);
  }

  return groups;
}
