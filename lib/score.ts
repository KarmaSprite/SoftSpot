/**
 * 整份提纲的总体评分。
 *
 * ## 为什么要有这个数
 *
 * 报告里每个点都有两个分数，但用户看完一屏点，脑子里剩下的只有一句
 * 「我这份到底行不行」。之前这个答案藏在测试面板的示例按钮上（90 / 60 / 40 / 20），
 * 那是我人工标的，跟报告里任何一个数字都不是同一套口径 ——
 * 同一个屏幕上出现「90」和「六红一绿」，用户只会觉得系统在自相矛盾。
 *
 * 现在这个数从报告自己的数据算出来，算法写在界面上，谁都能验算。
 *
 * ## 公式
 *
 *   每条主张 = (100 - 别人做过) × 0.5 + 答得上来 × 0.5
 *   总分     = 所有主张的平均，四舍五入
 *
 * 为什么两项各占一半：
 *   这是一张二维地图，两个轴本来就是平等的。
 *   只算纵轴，等于鼓励用户把选题写成没人做过的冷门方向；
 *   只算横轴，等于鼓励他把选题写到没人碰过的地方 —— 两种都是错的。
 *
 * 为什么用 `100 - overlap`：
 *   overlap 高 = 别人做过了 = 这个选题的原创空间小，对用户不利。
 *   换算成「新」这一侧，两项才是同一个方向（越高越好），平均才有意义。
 *
 * ## 为什么不算查不到的那几条
 *
 * 检索没做成的主张，overlap 是 0，但那个 0 的意思是「不知道」。
 * 把它当「没人做过」代进公式，等于白送 50 分 —— 好消息造假最伤信任。
 * 所以这类主张整个排除在平均之外，并且单独告诉用户「有 N 条没算进来」。
 */

import { QUADRANT_THRESHOLD } from "./quadrant.ts";

/** 一条主张对总分的贡献（0-100）。 */
export function claimScore(overlap: number, defensibility: number): number {
  /*
    先夹住再算。上游（检索层、证据层）理论上都吐 0-100，
    但总分是界面上最大的那个数字，它不能因为上游出一次 bug 就显示成 -20 分。
    这种夹子放在边界上，成本是一行，收益是"最坏情况下也不说出一个不可能的数"。
  */
  const safeOverlap = Math.min(100, Math.max(0, overlap));
  const safeDefensibility = Math.min(100, Math.max(0, defensibility));

  const novelty = 100 - safeOverlap;
  return Math.round((novelty + safeDefensibility) / 2);
}

export type OverallScore = {
  /** 0-100。一条都算不出来时是 null。 */
  score: number | null;
  /** 参与计算的主张条数。 */
  counted: number;
  /** 因为没查成而被排除的条数。 */
  excluded: number;
  /** 横轴平均（只算参与计算的那些）。 */
  averageOverlap: number;
  /** 纵轴平均（只算参与计算的那些）。 */
  averageDefensibility: number;
  /** 分档文案，直接显示。 */
  verdict: string;
  /** 一句话解释这个分是怎么来的。 */
  reason: string;
};

/** 分档。分界线取 30 / 50 / 70，写死，不做成可配置。 */
const BANDS: Array<{ min: number; verdict: string }> = [
  { min: 70, verdict: "准备得比较扎实" },
  { min: 50, verdict: "大部分能答上来" },
  { min: 30, verdict: "有底子，但软肋明显" },
  { min: 0, verdict: "现在去答辩会很吃力" },
];

/**
 * 算整份报告的总体分。
 *
 * 入参用最小形状（只要 overlap 和 defensibility），不直接吃 Claim ——
 * 这样自检脚本里造两条假数据就能测，不用凑齐 Claim 的五个字段。
 */
export function overallScore(
  items: Array<{ id: string; overlap: number; defensibility: number }>,
  blindClaimIds: string[] = [],
): OverallScore {
  const blind = new Set(blindClaimIds);
  const usable = items.filter((item) => !blind.has(item.id));
  const excluded = items.length - usable.length;

  if (usable.length === 0) {
    return {
      score: null,
      counted: 0,
      excluded,
      averageOverlap: 0,
      averageDefensibility: 0,
      verdict: "算不出来",
      reason:
        excluded > 0
          ? "这次一条主张都没查成，「别人做过吗」全是未知，硬算出来的分会是假的。"
          : "还没有主张可以算。",
    };
  }

  const sumOverlap = usable.reduce((sum, item) => sum + item.overlap, 0);
  const sumDef = usable.reduce((sum, item) => sum + item.defensibility, 0);
  const averageOverlap = Math.round(sumOverlap / usable.length);
  const averageDefensibility = Math.round(sumDef / usable.length);

  const total = usable.reduce(
    (sum, item) => sum + claimScore(item.overlap, item.defensibility),
    0,
  );
  const score = Math.round(total / usable.length);

  const band = BANDS.find((item) => score >= item.min) ?? BANDS[BANDS.length - 1];

  const parts = [
    `${usable.length} 条主张，横轴平均 ${averageOverlap}、纵轴平均 ${averageDefensibility}`,
  ];
  if (excluded > 0) {
    parts.push(`另有 ${excluded} 条没查成，没算进来`);
  }
  if (averageOverlap >= QUADRANT_THRESHOLD) {
    parts.push("一半以上的想法别人做过");
  }

  return {
    score,
    counted: usable.length,
    excluded,
    averageOverlap,
    averageDefensibility,
    verdict: band.verdict,
    reason: parts.join("；") + "。",
  };
}

/**
 * 这个分是怎么算的，原样显示给用户看。
 *
 * 为什么要把公式摊在界面上：这个数会直接影响用户对自己选题的判断，
 * 一个说不清来源的分数，用户要么迷信要么无视，两种都没好处。
 */
export const SCORE_FORMULA_TEXT =
  "每条 =（100 − 别人做过）× 0.5 + 答得上来 × 0.5，再取平均。查不到的那几条不算。";
