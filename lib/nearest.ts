/**
 * 「离主场最近的一条」。纯函数，不调模型，不读环境变量。
 *
 * 为什么要有这个文件：
 * 报告里「你的主场」那一块，在一条都没进主场的时候只会说
 * 「这一版还没看到稳的地方，先把最该改的地方补上」——
 * 这话没错，但它没告诉用户**补哪一条、补什么**。
 * 用户看完只知道"我不行"，不知道下一步动哪里，于是关掉页面。
 *
 * 所以这里算出：离进主场最近的那一条、两个轴各差几分、
 * 卡在哪个证据维度上、该补什么。给路径，不给判决。
 *
 * 为什么不是"把门槛降低让更多条进来"：
 * 那是把软肋藏起来。这一步只回答"差多少"，
 * 分界线还是写死的 50，一分不让。
 */

import { QUADRANT_THRESHOLD } from "./quadrant.ts";
import type { Claim } from "./schema.ts";

/* ---------------------------------------------------------------
   1. 输入类型
   --------------------------------------------------------------- */

/**
 * 证据分的一个维度。跟 lib/evidence.ts 的 DimensionHit 同形，
 * 但这里只要 name 和 score —— 界面不展示命中了哪些词，
 * 也就不必让客户端把 hits 一起拖过来。
 */
export type EvidenceDimension = {
  name: string;
  score: number;
  hits?: string[];
};

/**
 * 一条主张的证据明细，形状对齐 /api/analyze 响应里的 evidence[]。
 *
 * 为什么不直接 import evidence.ts 的 EvidenceResult：
 * 那个类型是服务端算出来的完整结果，客户端拿到的只是它的一部分。
 * 客户端自己声明"我期待收到什么"，服务端多给字段也不会炸。
 */
export type EvidenceLite = {
  claimId: string;
  score: number;
  dimensions: EvidenceDimension[];
};

/* ---------------------------------------------------------------
   2. 输出类型
   --------------------------------------------------------------- */

/** 卡在哪一根轴上。 */
export type Blocker =
  /** 纵轴不够：提纲里没证据，这个用户自己能补 */
  | "defensibility"
  /** 横轴太高：别人做过了，得收窄角度或讲清差异 */
  | "overlap"
  /** 两头都差 */
  | "both";

export type NearestHome = {
  claim: Claim;
  /** 提纲里的原始序号（从 0 开始），界面显示时 +1，跟地图、主张表对得上 */
  index: number;
  /** 纵轴还差几分，0 表示已经够了 */
  defGap: number;
  /** 横轴还差几分（要往下掉多少才够新），0 表示已经够新 */
  overlapGap: number;
  blocker: Blocker;
  /** 四个证据维度里最弱的那一项。拿不到证据明细时为 null */
  weakestDimension: { name: string; score: number } | null;
  /** 一句人话：该补什么 */
  advice: string;
};

/* ---------------------------------------------------------------
   3. 每个维度该补什么
   --------------------------------------------------------------- */

/**
 * 四个证据维度对应的动作。
 *
 * 为什么要写成"补什么"而不是"你缺什么"：
 * 用户已经知道自己缺了（分数就摆在那儿），
 * 再告诉他一遍只是在重复坏消息。他要的是下一步做什么。
 */
export const DIMENSION_ADVICE: Record<string, string> = {
  有没有数字: "补样本量或效果数字 —— 几个班、多少人、几周、提升多少。",
  有没有方法: "补研究方法 —— 前后测、对照班、量表、访谈。",
  有没有出处: "补依据来源 —— 哪篇文献、哪次调查、哪份文件。",
  说得具体吗: "把话说具体 —— 在什么场景、对谁、做什么。",
};

/** 横轴卡住时说的话。跟证据无关，是选题角度的问题。 */
const OVERLAP_ADVICE = "这条别人做过了，收窄一点，或者写清你和那篇的差别。";

/* ---------------------------------------------------------------
   4. 差几分
   --------------------------------------------------------------- */

/**
 * 两条轴各差几分才进主场。
 *
 * 纵轴：`defensibility >= 50` 就算够，所以差的是 `50 - def`。
 *
 * 横轴要小心：`getQuadrant` 里 50 分算「别人做过」那一侧（见 quadrant.ts 的 >=），
 * 所以要降到 49 才算真的进了「新」这一侧。因此差的是 `overlap - 49`，
 * 不是 `overlap - 50` —— 差 1 分不能糊弄成"差 0 分"。
 *
 * 两个数都用 `QUADRANT_THRESHOLD` 推出来，不写死 50 / 49，
 * 将来真要动分界线（虽然说了不动）也只改一个地方。
 */
export function gapToHome(claim: Claim): {
  defGap: number;
  overlapGap: number;
} {
  const defGap = Math.max(0, QUADRANT_THRESHOLD - claim.defensibility);
  const overlapGap = Math.max(0, claim.overlap - (QUADRANT_THRESHOLD - 1));
  return { defGap, overlapGap };
}

/* ---------------------------------------------------------------
   5. 坐标轴文案
   --------------------------------------------------------------- */

/**
 * 纵轴差多少，说成人话。
 *
 * 差 0 分不能显示成「差 0 分」—— 那句话读起来像在挖苦人，
 * 而且它想表达的是"这根轴没问题了"，是个好消息。
 */
export function describeDefGap(defGap: number): string {
  return defGap === 0 ? "已经够稳" : `差 ${defGap} 分`;
}

/** 横轴差多少，说成人话。差 0 表示已经够新。 */
export function describeOverlapGap(overlapGap: number): string {
  return overlapGap === 0 ? "已经够新" : `差 ${overlapGap} 分`;
}

/* ---------------------------------------------------------------
   6. 挑最弱维度
   --------------------------------------------------------------- */

/**
 * 四个维度里挑分数最低的那个。
 *
 * 同分时取排在前面的那个 —— evidence.ts 里维度的顺序是
 * 数字 / 方法 / 出处 / 具体，所以同分优先报「数字」和「方法」：
 * 这两个是答辩老师最先追问的，先说更值钱。
 *
 * 实现上靠"严格小于"保留第一个最小值，不另写排序。
 */
function pickWeakest(
  dimensions: EvidenceDimension[] | undefined
): { name: string; score: number } | null {
  if (!dimensions || dimensions.length === 0) return null;

  let weakest = { name: dimensions[0].name, score: dimensions[0].score };
  for (const dim of dimensions) {
    if (dim.score < weakest.score) {
      weakest = { name: dim.name, score: dim.score };
    }
  }
  return weakest;
}

/* ---------------------------------------------------------------
   7. 主函数
   --------------------------------------------------------------- */

/**
 * 找出离主场最近的那一条。
 *
 * 返回 null 的三种情况（这时候界面该退回原来那句"还没看到稳的地方"）：
 *   1. 一条主张都没有
 *   2. 所有主张的查重都没做成 —— 我们不知道，不是"没有"
 *   3. 已经有主张在主场里了 —— 那时不该显示"最近的一条"，
 *      该显示主场本身
 *
 * 为什么 blind 的必须排掉：
 * 它们的 overlap 是 0，0 在四象限里算「没人做过」，
 * 配上高 defensibility 看起来离主场只有一步，其实这一步根本没量过。
 * 把它当"最近的一条"等于替用户吹一个没验证过的牛。
 */
export function findNearestHome(
  claims: Claim[],
  blindClaimIds: string[],
  evidence: EvidenceLite[]
): NearestHome | null {
  if (claims.length === 0) return null;

  const blindSet = new Set(blindClaimIds);
  const evidenceById = new Map(evidence.map((item) => [item.claimId, item]));

  const candidates: NearestHome[] = [];

  claims.forEach((claim, index) => {
    if (blindSet.has(claim.id)) return;

    const { defGap, overlapGap } = gapToHome(claim);
    const total = defGap + overlapGap;

    /**
     * 总差距为 0 说明它已经在主场里了。
     * 这里排掉，是为了让调用方就算在有主场时误调本函数，
     * 也不会把"已经在主场的那条"当成"离主场最近的"再说一遍。
     */
    if (total === 0) return;

    const dimensions = evidenceById.get(claim.id)?.dimensions;
    const weakestDimension = pickWeakest(dimensions);

    const blocker: Blocker =
      defGap > 0 && overlapGap > 0
        ? "both"
        : defGap > 0
          ? "defensibility"
          : "overlap";

    candidates.push({
      claim,
      index,
      defGap,
      overlapGap,
      blocker,
      weakestDimension,
      advice: buildAdvice(blocker, weakestDimension),
    });
  });

  if (candidates.length === 0) return null;

  /**
   * 排序：总差距小的在前。
   *
   * 总差距一样时，纵轴高的排前面 ——
   * 纵轴是用户自己能补的（补数据、补方法），横轴要靠改选题角度。
   * 同样差 10 分，能补的那条更值得先给他。
   *
   * 最后按原始序号兜底，保证同样的输入永远得到同样的顺序，
   * 不会因为排序不稳定而在两次刷新之间换一条显示。
   */
  candidates.sort((a, b) => {
    const totalA = a.defGap + a.overlapGap;
    const totalB = b.defGap + b.overlapGap;
    if (totalA !== totalB) return totalA - totalB;
    if (a.claim.defensibility !== b.claim.defensibility) {
      return b.claim.defensibility - a.claim.defensibility;
    }
    return a.index - b.index;
  });

  return candidates[0];
}

/* ---------------------------------------------------------------
   8. 拼那句话
   --------------------------------------------------------------- */

/**
 * 按"卡在哪根轴"拼出建议。
 *
 * 三种情况的语气不一样，因为要做的事不一样：
 *   - 只卡纵轴：好办，补证据，这是用户今晚就能动手的
 *   - 只卡横轴：不好办，要改角度，但分数已经很高了，值得一说
 *   - 两头都卡：先补证据再看横轴，一次改一件
 */
function buildAdvice(
  blocker: Blocker,
  weakest: { name: string; score: number } | null
): string {
  const action = weakest ? DIMENSION_ADVICE[weakest.name] : null;

  if (blocker === "overlap") {
    return OVERLAP_ADVICE;
  }

  if (!weakest || !action) {
    /**
     * 拿不到证据明细（老接口、或者这一条没算出来）。
     * 不能编一个维度名出来，只说最笼统但一定正确的那句。
     */
    return "补证据：样本量、研究方法、依据来源，三样里挑最缺的补。";
  }

  if (blocker === "both") {
    return `两头都差。先补「${weakest.name}」：${action}横轴那边再收窄一点。`;
  }

  return `卡在「${weakest.name}」：${action}`;
}
