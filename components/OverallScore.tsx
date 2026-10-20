/**
 * 报告顶部那个总分。
 *
 * ## 为什么要单独一块
 *
 * 用户看完一屏点，脑子里剩下的是一个问句：「我这份到底行不行」。
 * 地图回答的是「哪儿有问题」，回答不了这个。之前这个答案藏在测试面板的示例按钮上
 * （90 / 60 / 40 / 20），那是我人工标的，跟报告里任何一个数字都不是同一套口径 ——
 * 同一个屏幕上出现「90」和「六红一绿」，用户只会觉得系统在自相矛盾。
 *
 * 现在这个数从报告自己的数据算出来，公式印在旁边，谁都能验算。
 *
 * ## 为什么把公式摊在界面上
 *
 * 一个说不清来源的分数，用户要么迷信要么无视，两种都没好处。
 * 摊开之后他能自己看出「原来我分低是因为横轴那一半」，
 * 这比多写十句解释有用。
 */

"use client";

import { SCORE_FORMULA_TEXT, SCORE_SCALE_TEXT, overallScore } from "@/lib/score";
import type { Claim } from "@/lib/types";

type Props = {
  claims: Claim[];
  blindClaimIds?: string[];
  /** 占位数据（还没接检索时）不显示分数，那时候分数是假的。 */
  placeholder?: boolean;
};

export default function OverallScore({ claims, blindClaimIds = [], placeholder }: Props) {
  // 占位态下所有分数都是 50，算出来必然是 50 分 —— 那是个假结论，不如不显示
  if (placeholder) return null;
  if (claims.length === 0) return null;

  const result = overallScore(claims, blindClaimIds);

  /*
    算不出来（一条都没查成）时也要显示这一块，但显示的是「算不出来」。
    直接不显示会让用户以为这个功能对他失效了；
    显示一个 0 分则是明确的假话 —— 0 分的意思是「你这份一无是处」，
    而实际情况是「我们没查到」。
  */
  return (
    <section className="overall">
      <div className="overall-main">
        <span className="overall-label">总体评分</span>
        <span className={`overall-value${result.score === null ? " is-unknown" : ""}`}>
          {result.score === null ? "—" : result.score}
          {result.score !== null && <span className="overall-max">/100</span>}
        </span>
        <span className={`overall-verdict${result.score === null ? " is-unknown" : ""}`}>
          {result.verdict}
        </span>
      </div>

      <div className="overall-side">
        <p className="overall-reason">{result.reason}</p>
        <p className="overall-formula">{SCORE_FORMULA_TEXT}</p>
        <p className="overall-formula overall-scale">{SCORE_SCALE_TEXT}</p>
      </div>
    </section>
  );
}
