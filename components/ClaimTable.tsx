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
};

export default function ClaimTable({ claims, placeholder = false }: Props) {
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

            return (
              <tr key={claim.id}>
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
