"use client";

/**
 * 主张表：把 L1 抽取出来的每条主张摊开给人看。
 *
 * 为什么用表格而不是卡片：
 * 主张是「并列可比」的东西，用户要一眼扫完六条、比较哪条分低。
 * 卡片适合逐条精读，表格适合横向对比，这里要的是后者。
 *
 * 为什么分数用横条不用数字：
 * 数字要读，横条要瞟。用户扫一眼就知道哪条最短，
 * 数字留着放在条尾，需要精确值时再看。
 */

import { CLAIM_TYPE_LABEL, type Claim, type ClaimType } from "@/lib/types";
import { QUADRANT_META, getClaimQuadrant } from "@/lib/quadrant";

/** 类型徽章的配色，靠 className 后缀区分。 */
const TYPE_CLASS: Record<ClaimType, string> = {
  problem: "badge-problem",
  method: "badge-method",
  expectation: "badge-expectation",
};

type Props = {
  claims: Claim[];
  /**
   * 分数是不是占位值。
   *
   * 占位状态下两个分数都是 50，而 50 在 getQuadrant 里算"高"侧，
   * 于是每一行都会被打上「有人做过了」的标签 —— 这是在说一句假话：
   * 我们根本还没查过。所以占位时把标签换成「待检索」，
   * 宁可显示"还不知道"，也不能显示一个自己没算过的结论。
   */
  placeholder?: boolean;
  /**
   * 查重没做成的主张。
   *
   * 这些主张的 overlap 是 0（lib/overlap.ts 在一个源都没答话时就这么返回），
   * 但 0 分在表格里读起来是"没人做过"——那是在说谎。
   * 所以「别人做过」那一列换成破折号加一句"这次没查成"。
   *
   * 「答得上来」那一列照常显示：这个分是数提纲里的数字和方法词算出来的，
   * 跟检索成没成功无关，是真分数。藏起来才是浪费。
   */
  blindClaimIds?: string[];
};

export default function ClaimTable({
  claims,
  placeholder = false,
  blindClaimIds = [],
}: Props) {
  const blindSet = new Set(blindClaimIds);

  return (
    <div className="table-wrap">
      <table className="claim-table">
        <thead>
          <tr>
            <th className="col-no">#</th>
            <th className="col-type">类型</th>
            <th className="col-text">主张原文</th>
            <th className="col-score">别人做过</th>
            <th className="col-score">答得上来</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim, index) => {
            const quadrant = getClaimQuadrant(claim);
            /*
              这一行的「别人做过」有没有分数。
              placeholder（第 5b-2 步的全占位状态）优先：那时候所有主张都没分数，
              整张表统一显示「待检索」，不单独挑几行出来。
            */
            const isBlind = !placeholder && blindSet.has(claim.id);

            return (
              <tr key={claim.id} className={isBlind ? "is-blind" : undefined}>
                <td className="col-no">{index + 1}</td>

                <td className="col-type">
                  <span className={`badge ${TYPE_CLASS[claim.type]}`}>
                    {CLAIM_TYPE_LABEL[claim.type]}
                  </span>
                </td>

                <td className="col-text">
                  <p className="claim-text">{claim.text}</p>
                  <p className="claim-meta">
                    <span className="claim-loc">{claim.location}</span>
                    {placeholder ? (
                      <span className="claim-quad claim-quad-pending">待检索</span>
                    ) : isBlind ? (
                      /*
                        判象限要两个轴，现在只有一个。
                        所以不给它上四象限的任何一种颜色 ——
                        一上色就等于替用户判过了。
                      */
                      <span className="claim-quad claim-quad-blind">不知道</span>
                    ) : (
                      <span className={`claim-quad claim-quad-${quadrant}`}>
                        {QUADRANT_META[quadrant].label}
                      </span>
                    )}
                  </p>
                </td>

                <td className="col-score">
                  {placeholder ? (
                    <span className="score-pending">—</span>
                  ) : isBlind ? (
                    <>
                      <span className="score-unknown">—</span>
                      <span className="score-unknown-note">这次没查成</span>
                    </>
                  ) : (
                    <>
                      <div className="score-bar">
                        <div
                          className="score-fill score-fill-overlap"
                          style={{ width: `${claim.overlap}%` }}
                        />
                      </div>
                      <span className="score-num">{claim.overlap}</span>
                    </>
                  )}
                </td>

                <td className="col-score">
                  {placeholder ? (
                    <span className="score-pending">—</span>
                  ) : (
                    <>
                      <div className="score-bar">
                        <div
                          className="score-fill score-fill-def"
                          style={{ width: `${claim.defensibility}%` }}
                        />
                      </div>
                      <span className="score-num">{claim.defensibility}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
