"use client";

/**
 * 软肋地图：四象限散点图。
 *
 * 为什么手写不引图表库：
 * 只需要十几个 div 做绝对定位，引一个图表库要多 300KB，
 * 而且为了改一个点的颜色还得去翻它的 API。手写反而更可控。
 *
 * 坐标约定（方案 A）：
 *   横轴 left  = overlap          → 越靠右，别人做过越多
 *   纵轴 top   = 100 - defensibility → 越靠上，你越答得上来
 * 注意纵轴用的是 100 减去分数，因为 CSS 的 top 是往下增大的。
 * 这一行换算是全组件唯一跟「方向」有关的地方，将来要翻方向只改这里。
 */

import { QUADRANT_META, getClaimQuadrant, type Quadrant } from "@/lib/quadrant";
import type { Claim } from "@/lib/types";

/** 每个象限在画布上的位置。左上=你的主场，右下=最该改的地方。 */
const CORNERS: { quadrant: Quadrant; pos: "tl" | "tr" | "bl" | "br" }[] = [
  { quadrant: "home", pos: "tl" },
  { quadrant: "crowded", pos: "tr" },
  { quadrant: "foggy", pos: "bl" },
  { quadrant: "weak", pos: "br" },
];

/**
 * 画布留白：点不能贴在图的最外圈。
 *
 * 分数量到 0 或 100 时，点会正好压在边框上 —— 圆点有 20px 直径，
 * 一半在框外被切掉，看起来像图坏了。留 3.5% 的边，极端值也完整可见。
 * 只影响显示位置，不影响 tooltip 里的真实分数。
 */
const PLOT_INSET = 3.5;

/** 两个点离得比这个近，就认为叠在一起了（单位：百分点）。 */
const MIN_GAP = 7;

/** 象限分界线（跟 lib/quadrant.ts 的 QUADRANT_THRESHOLD 一致）。 */
const MID = 50;

/** 推开时离分界线至少留这么远，免得贴着线看起来像越界了。 */
const BOUNDARY_MARGIN = 1.5;

/**
 * 把挨得太近的点推开。
 *
 * 为什么需要：两条主张分数接近时（比如 70/6 和 68/6），
 * 两个圆点会精确重叠，编号「1」「3」挤成一团，用户只能看到一个点，
 * 会以为系统漏了一条主张 —— 而"少了一条"和"那条跟别人一样"是两件事。
 *
 * 做法：按顺序摆，每个点如果撞上已经摆好的点，就按固定角度往外挪一点，
 * 挪到一个不撞的位置为止。角度表是写死的，同一份数据每次画出来都一样，
 * 不会出现刷新一次点就换个地方的情况。
 *
 * **推的时候不许越过象限分界线**：这个点属于哪个象限是算出来的（看分数），
 * 如果为了躲重叠把它推到线另一边，它就会压在另一个象限的底色上 ——
 * 颜色和结论自相矛盾，比两个点叠在一起更让人糊涂。
 * 所以横向、纵向都夹在原来那一侧。
 */
const NUDGE_ANGLES = [-35, 35, -70, 70, -110, 110, -145, 145, 180];

function spreadPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [];

  for (const point of points) {
    // 先夹进画布，再判断要不要推开 —— 分数 0 和 100 也要留出边距
    let x = clampToPlot(point.x);
    let y = clampToPlot(point.y);

    for (const angle of NUDGE_ANGLES) {
      const taken = placed.some((other) => Math.hypot(other.x - x, other.y - y) < MIN_GAP);
      if (!taken) break;

      const rad = (angle * Math.PI) / 180;
      x = keepSide(point.x + Math.cos(rad) * MIN_GAP, point.x);
      y = keepSide(point.y + Math.sin(rad) * MIN_GAP, point.y);
    }

    placed.push({ x, y });
  }

  return placed;
}

/**
 * 把推开的坐标夹在「原来那一侧的象限里」。
 *
 * 原来在 50 右边（overlap 高）就还是留在右边，左边同理。
 * 正好等于 50 的点不夹 —— 它本来就压在线上，推哪边都不算改变结论。
 */
function keepSide(value: number, original: number): number {
  const clamped = clampToPlot(value);

  if (original > MID) return Math.max(MID + BOUNDARY_MARGIN, clamped);
  if (original < MID) return Math.min(MID - BOUNDARY_MARGIN, clamped);
  return clamped;
}

function clampToPlot(value: number): number {
  return Math.min(100 - PLOT_INSET, Math.max(PLOT_INSET, value));
}

type Props = {
  claims: Claim[];
  /**
   * 分数还没算出来（第 12 步接上检索之前）。
   *
   * 为 true 时不画点，只在画布上留一句说明。
   * 为什么必须这样：这时候所有主张的 overlap 和 defensibility 都是 50，
   * 而 50 正好是四象限分界线 —— 九个点会精确地叠在画布正中心，
   * 画出来只有一个点。用户会以为"我的提纲只有一条主张"或者"图坏了"。
   * 画一个诚实的空状态，比画一个错得看不出来的图好。
   */
  placeholder?: boolean;
};

export default function SoftSpotMap({ claims, placeholder = false }: Props) {
  const showDots = !placeholder;

  /*
     先把每条主张的原始位置算出来，再统一推开重叠的点。
     两件事分开做：位置是数据，推开是显示，混在一起以后就没法单独验证坐标对不对。
  */
  const rawPositions = claims.map((claim) => ({
    x: claim.overlap,
    y: 100 - claim.defensibility,
  }));
  const positions = spreadPoints(rawPositions);

  return (
    <div className="map-block">
      <div className="map" role="img" aria-label="软肋地图：每条主张按新旧和把握程度落在四象限">
        {/* 四块象限底色 */}
        {CORNERS.map(({ quadrant, pos }) => (
          <div
            key={`bg-${quadrant}`}
            className={`map-quad map-quad-${pos} map-bg-${quadrant}`}
          />
        ))}

        {/* 两条分界线 */}
        <div className="map-axis map-axis-h" />
        <div className="map-axis map-axis-v" />

        {/* 四角标签 */}
        {CORNERS.map(({ quadrant, pos }) => (
          <span
            key={`tag-${quadrant}`}
            className={`map-tag map-tag-${pos} map-tag-${quadrant}`}
          >
            {QUADRANT_META[quadrant].label}
          </span>
        ))}

        {/*
          待检索态：不画点，盖一层说明。
          这层用 absolute 铺满画布而不是替掉整个 .map，
          是因为四个象限底色和标签还要留着 —— 用户得先看懂这张图该怎么读，
          才知道等分数算出来之后该往哪儿看。
        */}
        {!showDots && (
          <div className="map-pending">
            <p className="map-pending-title">分数还没算</p>
            <p className="map-pending-body">
              这 {claims.length} 条主张的分数都是占位值，全在正中间那条线上，
              画出来只会叠成一个点。等接上 arXiv 和 Crossref，点才会散开。
            </p>
          </div>
        )}

        {/* 每条主张一个点 */}
        {showDots &&
          claims.map((claim, index) => {
            const quadrant = getClaimQuadrant(claim);
            const point = positions[index];
            const tipSide = [
              point.x > 62 ? "tip-left" : "",
              point.y < 38 ? "tip-down" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={claim.id}
                className="spot"
                style={{
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                }}
              >
                <span className={`spot-dot spot-dot-${quadrant}`}>
                  {index + 1}
                </span>
                <div className={`spot-tip ${tipSide}`}>
                  <p className="spot-tip-text">{claim.text}</p>
                  <div className="spot-tip-meta">
                    <span className={`spot-tip-quad spot-tip-quad-${quadrant}`}>
                      {QUADRANT_META[quadrant].label}
                    </span>
                    <span>别人做过 {claim.overlap}</span>
                    <span>答得上来 {claim.defensibility}</span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/*
        轴说明。原先是「纵轴 下 答不上来 ｜ 答得上来 上」，
        中文顺着箭头念不通，读的人要停一下才反应过来。
        改成「名称 + 两端各是什么」的写法，不需要读方向。
      */}
      <div className="map-axis-note">
        <span>
          <b>横轴 · 别人做过</b> 0 全新 ｜ 100 撞车
        </span>
        <span>
          <b>纵轴 · 答得上来</b> 0 没底 ｜ 100 很稳
        </span>
      </div>

      {/* 图例 */}
      <ul className="map-legend">
        {(["weak", "foggy", "crowded", "home"] as Quadrant[]).map((q) => (
          <li key={q}>
            <span className={`legend-dot legend-dot-${q}`} />
            {QUADRANT_META[q].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
