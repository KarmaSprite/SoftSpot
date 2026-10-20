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
/**
 * 推开时试的方向：每 10 度一个，绕一圈。
 *
 * **为什么不是手写 9 个角度**：手写的那 9 个（-35 / 35 / -70 / 70 / …）是
 * 等间隔 70 度挑出来的，看着均匀，实际在「必须往某个窄扇区躲」的时候会整个错过。
 * 实测一份真实报告里三个点挤在 (61,48)(63,48)(66,48) 这一小块，
 * 其中一个点最后被推到了 12.6 个百分点以外 —— 因为近处唯一能站的位置
 * 恰好落在两个手写角度之间。它没有出现在图上，用户看到的是一个
 * 「别人做过 63」的主张被画在 75 的位置上，那是假的位置。
 *
 * 每 10 度一个之后，同一份数据里那个点只挪了 10.5 个百分点。
 * 仍然是写死的表，同一份数据每次画出来位置一样。
 */
const NUDGE_ANGLES: number[] = (() => {
  const angles = [0];
  for (let step = 10; step <= 180; step += 10) {
    angles.push(step, -step);
  }
  return angles;
})();

/**
 * 推开时试的几档距离（单位：百分点），从小到大。
 *
 * **为什么不能只用一档**：实测一份真实报告里有两个点挤在 0.58 个百分点上 ——
 * 一个在 (51, 39)，另一个在 (51, 45)。按固定 7 个百分点推 9 个角度，
 * 每一个角度算出来的横坐标都被 `keepSide` 夹回 51.5（它紧贴分界线，
 * 只许往右挪），纵向又挪不够，9 个角度全撞着，循环结束就默默接受了重叠。
 *
 * 所以往外多试几档：7 不行就 10.5，再不行 15.4、21。
 * 从小到大试，是为了让点尽量待在真实位置附近 ——
 * 挪 7 个点就能分开的，不该挪到 21 去。
 */
const NUDGE_RADII = [MIN_GAP, MIN_GAP * 1.5, MIN_GAP * 2.2, MIN_GAP * 3];

/**
 * 把挨得太近的点推开。
 *
 * 为什么需要：两条主张分数接近时（比如 70/6 和 68/6），
 * 两个圆点会精确重叠，编号「1」「3」挤成一团，用户只能看到一个点，
 * 会以为系统漏了一条主张 —— 而"少了一条"和"那条跟别人一样"是两件事。
 *
 * 做法：按顺序摆，每个点如果撞上已经摆好的点，就按固定角度、由近到远
 * 往外挪，挪到一个不撞的位置为止。角度表和距离档位都是写死的，
 * 同一份数据每次画出来都一样，不会出现刷新一次点就换个地方的情况。
 *
 * **推的时候不许越过象限分界线**：这个点属于哪个象限是算出来的（看分数），
 * 如果为了躲重叠把它推到线另一边，它就会压在另一个象限的底色上 ——
 * 颜色和结论自相矛盾，比两个点叠在一起更让人糊涂。
 * 所以横向、纵向都夹在原来那一侧。
 *
 * **实在推不开怎么办**：所有档位所有角度都撞着时，退而求其次，
 * 挑一个「离其他点最远」的位置。这样至少不会精确重合，
 * 两个编号能看出是两团。不设这个兜底的话，循环会停在最后一个
 * 被夹回原地的候选上，等于什么都没做。
 */
function spreadPoints(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [];

  for (const point of points) {
    // 先夹进画布，再判断要不要推开 —— 分数 0 和 100 也要留出边距
    const baseX = clampToPlot(point.x);
    const baseY = clampToPlot(point.y);

    let chosen = { x: baseX, y: baseY };

    const collides = placed.some((other) => Math.hypot(other.x - baseX, other.y - baseY) < MIN_GAP);

    if (collides) {
      let found: { x: number; y: number } | null = null;
      let fallback: { x: number; y: number } = chosen;
      let fallbackClearance = -1;

      outer: for (const radius of NUDGE_RADII) {
        for (const angle of NUDGE_ANGLES) {
          const rad = (angle * Math.PI) / 180;
          const x = keepSide(point.x + Math.cos(rad) * radius, point.x);
          const y = keepSide(point.y + Math.sin(rad) * radius, point.y);

          const clearance = placed.reduce(
            (min, other) => Math.min(min, Math.hypot(other.x - x, other.y - y)),
            Number.POSITIVE_INFINITY,
          );

          if (clearance >= MIN_GAP) {
            found = { x, y };
            break outer;
          }

          // 全都撞着的时候留一个最好的（离其他点最远那个）
          if (clearance > fallbackClearance) {
            fallbackClearance = clearance;
            fallback = { x, y };
          }
        }
      }

      chosen = found ?? fallback;
    }

    placed.push(chosen);
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

/**
 * 左边「不知道」那一列专用的推开逻辑：**只动上下，不动左右**。
 *
 * 为什么不能复用 spreadPoints：那一列只有 72px 宽（手机上 46px），
 * 横向挪 7 个百分点就会跑到框外面去。而纵向只有一个自由度，
 * 反而更容易撞 —— 两条主张的「答得上来」分数一样时，两个圆圈会完全重叠。
 *
 * 推的方向固定先往下、再往上，交替加距离，跟 spreadPoints 一样是写死的，
 * 同一份数据每次画出来位置一样。
 */
function spreadVertically(values: number[]): number[] {
  const placed: number[] = [];

  return values.map((raw) => {
    let y = clampToPlot(raw);

    for (const step of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const taken = placed.some((other) => Math.abs(other - y) < MIN_GAP);
      if (!taken) break;
      y = clampToPlot(raw + step * MIN_GAP);
    }

    placed.push(y);
    return y;
  });
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
  /**
   * 检索一个数据库都没答话的主张 id。
   *
   * 这些主张的 overlap 是 0，但那个 0 不是"没人做过"，是"不知道"。
   * 画在图里会落在最左边，读起来正好是最乐观的结论 —— 那是假话。
   * 所以它们不进四象限，单独摆在左边一列，纵轴（答得上来）照用，
   * 因为纵轴是数提纲里的证据算出来的，跟检索成没成功没关系，是真分数。
   */
  blindClaimIds?: string[];
};

export default function SoftSpotMap({
  claims,
  placeholder = false,
  blindClaimIds = [],
}: Props) {
  const showDots = !placeholder;

  /*
     先把主张分成两堆，但编号保留它在原始数组里的位置。
     为什么不能重新编号：主张表里 1 号就是 1 号，地图上 1 号跑到别处去了，
     用户拿着两张东西对不上，会以为看串了。
  */
  const blindSet = new Set(blindClaimIds);
  const indexed = claims.map((claim, index) => ({ claim, index }));
  const blindItems = indexed.filter(({ claim }) => blindSet.has(claim.id));
  const knownItems = indexed.filter(({ claim }) => !blindSet.has(claim.id));

  /*
     先把每条主张的原始位置算出来，再统一推开重叠的点。
     两件事分开做：位置是数据，推开是显示，混在一起以后就没法单独验证坐标对不对。
  */
  const knownPositions = spreadPoints(
    knownItems.map(({ claim }) => ({
      x: claim.overlap,
      y: 100 - claim.defensibility,
    })),
  );

  const blindTops = spreadVertically(blindItems.map(({ claim }) => 100 - claim.defensibility));

  const showBlindColumn = showDots && blindItems.length > 0;
  const mapIsEmpty = showDots && knownItems.length === 0;

  return (
    <div className="map-block">
      <div className={`map-row${showBlindColumn ? " map-row-blind" : ""}`}>
        {/*
          左边这一列：横轴未知的主张。
          高度跟地图完全一样（父级 align-items: stretch），
          所以同一个「答得上来」分数在两边的视觉高度是对得上的。

          标题用绝对定位挂在栏的上方（bottom: 100%），不占栏内空间 ——
          一旦让它占位，栏的可绘制区域就比地图矮一截，
          栏里的点会整体往下偏一点点，"纵轴照用"就成了半句假话。
        */}
        {showBlindColumn && (
          <div className="map-blind">
            <div className="map-blind-cap">
              <p className="map-blind-title">不知道</p>
              {/*
                这里只能放四个字。栏在手机上只有 46px 宽，
                「横轴没查到」五个字会折成「横轴没查 / 到」两行，
                底下多出来的「到」看着像排版坏了。
              */}
              <p className="map-blind-note">横轴未知</p>
            </div>

            {blindItems.map(({ claim, index }, i) => (
              <div
                key={claim.id}
                className="spot"
                style={{ left: "50%", top: `${blindTops[i]}%` }}
              >
                <span className="spot-dot spot-dot-blind">{index + 1}</span>
                <div className="spot-tip">
                  <p className="spot-tip-text">{claim.text}</p>
                  <div className="spot-tip-meta">
                    <span className="spot-tip-quad spot-tip-quad-blind">这次没查到</span>
                    <span>答得上来 {claim.defensibility}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          className="map"
          role="img"
          aria-label="软肋地图：每条主张按新旧和把握程度落在四象限"
        >
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

          {/*
            全部主张都没查成：四象限里一个点都没有。
            这时候必须说清楚"是没查到，不是全都不撞车"——
            一片空白的四象限看起来像"你的选题全新、全都没问题"，
            那是这张图能给出的最危险的误读。
          */}
          {mapIsEmpty && (
            <div className="map-empty">
              {/*
                说明文字必须装在一块实心底板上。
                不装的话四象限的十字分界线会从字中间穿过去，
                一段话被切成四块，读起来像排版坏了。
              */}
              <div className="map-empty-plate">
                <p className="map-empty-title">这次一个库都没答话</p>
                <p className="map-empty-body">
                  所以「别人做过吗」这一项对每条主张都不知道。左边那列的点只标了「你答得上来吗」，
                  横轴是空的 —— 别照着这张图判断选题新不新。
                </p>
              </div>
            </div>
          )}

          {/* 每条分数可信的主张一个点 */}
          {showDots &&
            knownItems.map(({ claim, index }, i) => {
              const quadrant = getClaimQuadrant(claim);
              const point = knownPositions[i];
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
                  <span className={`spot-dot spot-dot-${quadrant}`}>{index + 1}</span>
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
        {showBlindColumn && (
          <span className="map-axis-note-blind">
            <b>左栏 · 不知道</b> 这次检索没答话，横轴分数不算数，只有纵轴是真的
          </span>
        )}
      </div>

      {/* 图例 */}
      <ul className="map-legend">
        {(["weak", "foggy", "crowded", "home"] as Quadrant[]).map((q) => (
          <li key={q}>
            <span className={`legend-dot legend-dot-${q}`} />
            {QUADRANT_META[q].label}
          </li>
        ))}
        {showBlindColumn && (
          <li>
            <span className="legend-dot legend-dot-blind" />
            这次没查到
          </li>
        )}
      </ul>
    </div>
  );
}
