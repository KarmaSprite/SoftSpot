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
 *
 * ## 第 24f 步为什么重排
 *
 * 用户的原话是「一堆字堆在一起没啥主次，每条=和刻度那里，一眼也看不懂」。
 * 原来右半边是三段连续的小字：理由 13px、公式 12px、刻度 12px，
 * 三行字号只差 1px，眼睛扫过去就是一团灰。
 *
 * 现在的层次：
 *   第一层  大数字 + 判词（左边，30px / 13px）
 *   第二层  一句理由（右边第一行，13px 正文色）
 *   第三层  怎么算的 / 刻度（一条浅分隔线之下，带标签的两行对照）
 *
 * 分隔线不是装饰：它把「说的是什么」和「怎么算出来的」分开，
 * 不想验算的人扫完第二层就可以停，视线不会被公式拽住。
 */

"use client";

import {
  SCORE_FORMULA_MAIN,
  SCORE_FORMULA_NOTE,
  SCORE_SCALE_POINTS,
  overallScore,
} from "@/lib/score";
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

        {/*
          下面这一块是「可核对」的内容，不是「必须读」的内容。
          用 dl 而不是三个 p：这两行都是「名称 + 内容」的对照关系，
          用 dl 之后标签天然对齐成一列，读屏也会念成「怎么算的：……」。
        */}
        <dl className="overall-how">
          <dt className="overall-how-term">怎么算的</dt>
          <dd className="overall-how-desc">
            <span className="overall-formula">{SCORE_FORMULA_MAIN}</span>
            <span className="overall-formula-note">{SCORE_FORMULA_NOTE}</span>
          </dd>

          <dt className="overall-how-term">刻度</dt>
          <dd className="overall-how-desc">
            <span className="overall-scale" aria-label="原始分换算成显示分的三个锚点">
              {SCORE_SCALE_POINTS.map((point) => (
                <span className="overall-scale-item" key={point.raw}>
                  <span className="overall-scale-raw">{point.raw}</span>
                  <span className="overall-scale-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="overall-scale-shown">{point.shown}</span>
                </span>
              ))}
            </span>
            <span className="overall-formula-note">其余按比例插值</span>
          </dd>
        </dl>
      </div>
    </section>
  );
}
