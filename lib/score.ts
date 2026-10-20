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
 * ## 两层：原始分和显示分
 *
 * 原始分（rawClaimScore）：
 *
 *   每条主张 = (100 - 别人做过) × 0.5 + 答得上来 × 0.5
 *   总分     = 所有主张的平均，四舍五入
 *
 * 显示分（claimScore）= 把原始分按一条固定刻度换算一次。
 *
 * ## 为什么原始分不能直接显示
 *
 * 原始分的 50 分**不代表「中等」**，它代表「两个轴都正好在中间」：
 * 横轴 50 意味着最像的那篇论文跟你有一半的词重合，
 * 纵轴 50 意味着有一半的质询你答不上来。两样都不算「还行」。
 *
 * 实测后果：两份把研究设计写到接近满分水平的提纲（样本量、仪器型号、
 * 采样率、信度系数、统计模型全写了），纵轴能到 78，横轴却压在 51-57，
 * 原始分只有 53-55。如果直接显示，用户会以为「我这么认真写也只有 55」，
 * 而这个判断是错的 —— 那份提纲写得确实比大多数人好。
 *
 * 所以加一条刻度：原始 40 → 58、55 → 70、70 → 84。
 * 它不是让测量变准，是把「原始分的刻度」翻译成「人能读懂的刻度」。
 * 这一点在答辩时要老实说：**换的是刻度，不是测量。**
 *
 * ## 为什么不算查不到的那几条
 *
 * 检索没做成的主张，overlap 是 0，但那个 0 的意思是「不知道」。
 * 把它当「没人做过」代进公式，等于白送 50 分 —— 好消息造假最伤信任。
 * 所以这类主张整个排除在平均之外，并且单独告诉用户「有 N 条没算进来」。
 */

import { QUADRANT_THRESHOLD } from "./quadrant.ts";

/**
 * 一条主张的原始分（0-100），不做刻度换算。
 *
 * 保留它并导出，是为了让「换刻度」这件事可被验证：
 * 自检脚本能分别验原始公式和刻度曲线，出了问题一眼看出是哪一层。
 */
export function rawClaimScore(overlap: number, defensibility: number): number {
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

/**
 * 刻度换算的锚点：原始分 → 显示分。
 *
 * 取点依据（都是真实跑出来的原始分）：
 *   16  → 20   只写了「我要研究什么」，没写怎么做（教育学·思辨那份）
 *   34  → 48   有想法、有一点设计（文学·网络文学那份）
 *   40  → 58   勉强算一份完整的开题
 *   55  → 70   研究设计写得很细，但选题撞得比较多
 *   70  → 84   又新又稳
 *   100 → 100  两头都满分（现实中拿不到，留作上限）
 *
 * 中间线性插值。锚点写死，不做成可配置 ——
 * 能调的分档等于没有分档，用户会一路调到让自己满意为止。
 */
const CALIBRATION: Array<[number, number]> = [
  [0, 0],
  [20, 25],
  [40, 58],
  [55, 70],
  [70, 84],
  [100, 100],
];

/** 把原始分按上面的锚点换算成显示分。 */
export function calibrateScore(raw: number): number {
  const clamped = Math.min(100, Math.max(0, raw));

  for (let i = 1; i < CALIBRATION.length; i += 1) {
    const [rawHigh, shownHigh] = CALIBRATION[i];
    if (clamped > rawHigh) continue;

    const [rawLow, shownLow] = CALIBRATION[i - 1];
    const span = rawHigh - rawLow;
    if (span <= 0) return Math.round(shownHigh);

    const ratio = (clamped - rawLow) / span;
    return Math.round(shownLow + ratio * (shownHigh - shownLow));
  }

  return Math.round(CALIBRATION[CALIBRATION.length - 1][1]);
}

/**
 * 跟已有的某篇论文几乎一模一样时，显示分封顶。
 *
 * 为什么需要这个兜底：原始公式里「别人做过 100 + 答得上来 100」和
 * 「没人做过 + 答不上来」都算 50 分。换刻度之后这两种都会变成 66 分，
 * 于是「整段照抄一篇论文，只是把证据写全」会显示成「写得比较扎实」。
 * 那是这套评分最不能犯的错 —— 它会给抄袭发一张合格证。
 *
 * 所以单独拦一道：横轴到 85 分以上，不管纵轴多高，显示分不超过 45。
 * 85 这个数取的是「最像的那篇跟你八成以上的词重合」，正常选题撞不到，
 * 撞到了就是同一篇东西。
 */
const COPIED_OVERLAP = 85;
const COPIED_CAP = 45;

/** 一条主张最终显示出来的分（0-100）。 */
export function claimScore(overlap: number, defensibility: number): number {
  const shown = calibrateScore(rawClaimScore(overlap, defensibility));
  const safeOverlap = Math.min(100, Math.max(0, overlap));

  return safeOverlap >= COPIED_OVERLAP ? Math.min(shown, COPIED_CAP) : shown;
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

/**
 * 分档。
 *
 * 分界线 40 / 60 / 75 是按用户要的口径定的：
 * 「写得好的落在 60-75，新颖而且扎实才 75 以上」。
 * 写死，不做成可配置。
 */
const BANDS: Array<{ min: number; verdict: string }> = [
  { min: 75, verdict: "新颖而且扎实" },
  { min: 60, verdict: "写得比较扎实" },
  { min: 40, verdict: "有底子，但软肋明显" },
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
  "每条 =（100 − 别人做过）× 0.5 + 答得上来 × 0.5，原始分再按一条固定刻度换算成显示分。查不到的那几条不算。";

/**
 * 刻度表，原样显示给用户，让他能自己验算。
 *
 * 为什么要摊出来：只写「按一条固定刻度换算」而不给刻度，
 * 等于让用户相信一个他看不见的黑箱 —— 那和直接给个分数没有区别。
 * 只挑四个中间锚点（0 和 100 太显然，20 那个点太靠底），
 * 多了会变成一张没人读的表。
 */
export const SCORE_SCALE_TEXT = "刻度：原始 40 → 58 · 55 → 70 · 70 → 84（其余按比例插值）";
