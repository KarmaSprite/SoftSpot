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
 *
 * 为什么每行能点开：
 * 光看两个数字，用户不知道它们是怎么来的 —— 分数就成了玄学。
 * 点开之后摊开四件事：这两个分是什么意思、最像的是哪一篇、
 * 四个证据维度各得几分、该改什么。诊断类产品给不出理由，
 * 用户只会觉得是随便给的数。
 */

import { Fragment, useState } from "react";
import { CLAIM_TYPE_LABEL, type Claim, type ClaimType } from "@/lib/types";
import { QUADRANT_META, getClaimQuadrant } from "@/lib/quadrant";
import {
  explainClaim,
  formatHits,
  type ExplainEvidence,
  type ExplainSearch,
} from "@/lib/explain";

/** 类型徽章的配色，靠 className 后缀区分。 */
const TYPE_CLASS: Record<ClaimType, string> = {
  problem: "badge-problem",
  method: "badge-method",
  expectation: "badge-expectation",
};

/** 维度条的颜色：越低越红。跟地图上「最该改」那个角用的是同一个色。 */
function dimensionClass(score: number): string {
  if (score >= 70) return "explain-fill explain-fill-good";
  if (score >= 40) return "explain-fill explain-fill-mid";
  return "explain-fill explain-fill-low";
}

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
  /** 每条主张的证据明细，展开时看「四个维度各得几分」。 */
  evidence?: ExplainEvidence[];
  /** 每条主张的检索明细，展开时看「最像的是哪一篇」。 */
  search?: ExplainSearch[];
};

export default function ClaimTable({
  claims,
  placeholder = false,
  blindClaimIds = [],
  evidence = [],
  search = [],
}: Props) {
  const blindSet = new Set(blindClaimIds);
  const evidenceById = new Map(evidence.map((item) => [item.claimId, item]));
  const searchById = new Map(search.map((item) => [item.claimId, item]));

  /*
    一次只展开一行。

    为什么不做成每行独立开合：表格有七八行，全展开之后
    每条都带四块内容，整页会长到没法读，而且用户想比较两条时
    还得手动把别的收起来。展开一条、收起上一条，读起来是「逐条过一遍」，
    跟这份报告的用法一致。
  */
  const [openId, setOpenId] = useState<string | null>(null);

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
            const open = openId === claim.id;
            const detail = open
              ? explainClaim(claim, evidenceById.get(claim.id), searchById.get(claim.id))
              : null;

            return (
              <Fragment key={claim.id}>
                <tr
                  className={[
                    isBlind ? "is-blind" : "",
                    open ? "is-open" : "",
                    "is-clickable",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setOpenId(open ? null : claim.id)}
                  /*
                    为什么用 tr 而不是把每行做成 button：
                    tr 里塞 role="button" 会让读屏把整行读成一个按钮，
                    里面五格内容就念不出来了。这里保留 tr 的表格语义，
                    只补 aria-expanded，读屏仍能逐格念，同时知道这行能展开。
                    代价是不能用 Tab 聚焦 —— 表格本来就该用读屏的表格导航，
                    而不是当一串按钮走。
                  */
                  aria-expanded={open}
                >
                  <td className="col-no">
                    <span className={`row-caret${open ? " is-open" : ""}`} aria-hidden="true">
                      ▸
                    </span>
                    {index + 1}
                  </td>

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

                {/*
                  展开区是独立的一个 <tr>，里面只有一个单元格横跨五列。

                  为什么不用「在原来那行的某个 td 里塞一块」：
                  表格的列宽是按 td 内容算的，往「主张原文」那一格塞四块内容
                  会把这个列撑到其他行也跟着变形。跨五列的独立行不参与列宽计算。
                */}
                <tr className="claim-detail-row">
                  <td colSpan={5} className="claim-detail-cell">
                    <div className={`claim-detail${open ? " is-open" : ""}`}>
                      <div className="claim-detail-inner">
                        {detail && (
                          <>
                            <p className="claim-detail-headline">{detail.headline}</p>

                            {detail.reference ? (
                              <div className="claim-ref">
                                <span className="claim-ref-label">最像的那一篇</span>
                                <a
                                  className="claim-ref-title"
                                  href={detail.reference.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  {detail.reference.title}
                                </a>
                                <span className="claim-ref-meta">
                                  {detail.reference.meta}
                                </span>
                                <span className="claim-ref-note">
                                  {detail.referenceNote}
                                </span>
                              </div>
                            ) : (
                              <div className="claim-ref is-empty">
                                <span className="claim-ref-label">最像的那一篇</span>
                                <span className="claim-ref-note">
                                  {detail.referenceNote}
                                </span>
                              </div>
                            )}

                            {detail.dimensions.length > 0 && (
                              <div className="claim-dims">
                                <span className="claim-ref-label">
                                  纵轴这几分是怎么来的
                                </span>
                                <ul className="claim-dim-list">
                                  {detail.dimensions.map((dimension) => (
                                    <li key={dimension.name} className="claim-dim">
                                      <span className="claim-dim-name">
                                        {dimension.name}
                                      </span>
                                      <span className="claim-dim-bar">
                                        <span
                                          className={dimensionClass(dimension.score)}
                                          style={{ width: `${dimension.score}%` }}
                                        />
                                      </span>
                                      <span className="claim-dim-score">
                                        {dimension.score}
                                      </span>
                                      <span className="claim-dim-hits">
                                        {formatHits(dimension.hits)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <p className="claim-advice">{detail.advice}</p>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
