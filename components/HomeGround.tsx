"use client";

/**
 * 你的主场。
 *
 * 为什么这块必须存在，而且必须放在最上面：
 * 所有诊断类产品都只告诉用户哪儿不好。用户扫完一张满是红黄点的图，
 * 情绪是往下走的，然后关掉页面 —— 问题他记住了，但他不会回来改。
 * 标出「又新又答得上来」的那几条，他才有理由留下：
 * 至少知道有哪些东西是不用动的。
 *
 * 为什么放在地图上面而不是下面：
 * 滚动顺序就是阅读顺序。先看到「你有两条站得住」，再看「哪三条最危险」，
 * 他才有力气看下去。反过来放，他可能已经关掉了。
 */

import { getClaimQuadrant } from "@/lib/quadrant";
import {
  findNearestHome,
  describeDefGap,
  describeOverlapGap,
  type EvidenceLite,
} from "@/lib/nearest";
import type { Claim } from "@/lib/types";

type Props = {
  claims: Claim[];
  /**
   * 查重没做成的主张。
   *
   * 这些主张的 overlap 是 0，而 0 在四象限里算「没人做过」，
   * 配上高的 defensibility 就会刚好落进 home 象限 ——
   * 但我们根本没查过，凭什么叫「你的主场」。
   * 所以这里必须把它们排掉，否则这块会替用户吹一个没验证过的牛。
   */
  blindClaimIds?: string[];
  /**
   * 分数还是占位值的状态（第 5b-2 步）。
   *
   * 那时候所有 overlap 都是 50，全部被判成 crowded，home 一定是空的。
   * 这时候显示「你还没有主场」是假话 —— 不是没有，是还没算。
   * 所以整个板块不渲染。
   */
  placeholder?: boolean;
  /**
   * 每条主张的证据明细（第 19c-2 步）。
   *
   * 只在「一条主场都没有」的时候用得上：那时要告诉用户
   * 离得最近的是哪一条、卡在哪个维度上。有主场的时候这块不显示。
   * 老接口没有这个字段，所以默认空数组 —— 拿不到就退回笼统的说法，
   * 不能编一个维度名出来。
   */
  evidence?: EvidenceLite[];
};

export default function HomeGround({
  claims,
  blindClaimIds = [],
  placeholder = false,
  evidence = [],
}: Props) {
  if (placeholder) return null;

  const blindSet = new Set(blindClaimIds);

  const home = claims
    .map((claim, index) => ({ claim, index }))
    .filter(
      ({ claim }) =>
        !blindSet.has(claim.id) && getClaimQuadrant(claim) === "home"
    )
    /*
      按「答得上来」从高到低排。
      用户最先想确认的是「哪条我最稳」，所以最稳的排第一，
      而不是按提纲里的原始顺序 —— 原始顺序对他此刻的决策没有意义。
    */
    .sort((a, b) => b.claim.defensibility - a.claim.defensibility);

  /*
    一条都不剩，而且原因是全都查重没做成：
    这时候「没看到稳的地方」也是假话 —— 我们不知道，不是没有。
  */
  const allBlind =
    claims.length > 0 && claims.every((claim) => blindSet.has(claim.id));

  /*
    只有真的没有主场时才去算「最近的一条」。
    有主场的时候算它没意义（而且 findNearestHome 会返回 null），
    但更重要的是：这里先判 home.length，是为了不让多算一次
    变成一个可能出错的路径。
  */
  const nearest =
    home.length === 0 && !allBlind
      ? findNearestHome(claims, blindClaimIds, evidence)
      : null;

  return (
    <section
      className={`home-ground${home.length === 0 ? " is-empty" : ""}`}
      aria-labelledby="home-ground-title"
    >
      <div className="home-ground-head">
        <h3 className="home-ground-title" id="home-ground-title">
          你的主场
        </h3>
        {home.length > 0 && (
          <span className="home-ground-count">{home.length} 条</span>
        )}
      </div>

      {home.length > 0 ? (
        <>
          <p className="home-ground-lede">
            这几条又新、你又答得上来，是你答辩时最有底气的地方。
            <b>先把它们放稳，别在改别的时候顺手把它们改掉了。</b>
          </p>

          <ol className="home-list">
            {home.map(({ claim, index }) => (
              <li className="home-item" key={claim.id}>
                {/* 编号用提纲里的原始序号，跟地图、跟主张表对得上 */}
                <span className="home-no">{index + 1}</span>
                <div className="home-body">
                  <p className="home-text">{claim.text}</p>
                  <p className="home-meta">
                    <span className="home-loc">{claim.location}</span>
                    <span className="home-score">
                      别人做过 <b>{claim.overlap}</b>
                    </span>
                    <span className="home-score">
                      答得上来 <b>{claim.defensibility}</b>
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : allBlind ? (
        /*
          全部查重都没做成。这里不能说「你还没有主场」，
          那是在用一个我们不知道的结论下判断。
        */
        <p className="home-ground-lede home-ground-empty">
          这次查重一条都没查成，判断不了哪条是你的主场。
          上面地图左边那一列就是没查成的，等数据库通了再看这块。
        </p>
      ) : (
        /*
          真的没有。不说「你没有主场」——那句话只有否定，没有下一步。
          先说这一版没看到稳的，再具体指出离得最近的那一条：
          差几分、卡在哪、该补什么。用户要的是下一步动哪里。
        */
        <>
          <p className="home-ground-lede home-ground-empty">
            这一版还没看到稳的地方。别急着泄气 ——
            先把下面这条补一补，它离主场只差一点。
          </p>

          {nearest && (
            <div className="home-nearest">
              <p className="home-nearest-head">
                离主场最近的是第
                <span className="home-nearest-no">{nearest.index + 1}</span>
                条
              </p>
              <p className="home-nearest-text">「{nearest.claim.text}」</p>
              <p className="home-nearest-gap">
                <span>
                  答得上来 <b>{nearest.claim.defensibility}</b>（
                  {describeDefGap(nearest.defGap)}）
                </span>
                <span>
                  别人做过 <b>{nearest.claim.overlap}</b>（
                  {describeOverlapGap(nearest.overlapGap)}）
                </span>
              </p>
              <p className="home-nearest-advice">{nearest.advice}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
