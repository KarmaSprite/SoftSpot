"use client";

/**
 * 质询问题清单：按「你答不上来的概率」从高到低排。
 *
 * 为什么排序放在组件里做，不依赖上游：
 * 上游（模型）返回的顺序不可靠，模型经常按提纲顺序吐出来。
 * 排序是纯算术，放在这里做，永远一样。
 *
 * 为什么不折叠、不分页：
 * 一共就 8 条，全部展开反而让人一眼看到全部风险。
 * 折叠会让用户少看几条，而这几条恰恰是最该看的。
 */

import type { Question } from "@/lib/types";

/** 风险阈值：70 分以上标红，以下标灰。 */
const RISK_DANGER = 70;

type Props = {
  questions: Question[];
};

export default function QuestionList({ questions }: Props) {
  // 复制一份再排，不改上游传进来的数组
  const sorted = [...questions].sort((a, b) => b.risk - a.risk);

  return (
    <ol className="question-list">
      {sorted.map((question, index) => {
        const isDanger = question.risk >= RISK_DANGER;

        return (
          <li
            key={question.id}
            className={`question-card${isDanger ? " is-danger" : ""}`}
          >
            <div className="question-head">
              <span className="question-no">{index + 1}</span>
              <p className="question-text">{question.question}</p>
              <span className={`risk-badge${isDanger ? " risk-high" : ""}`}>
                {question.risk}
              </span>
            </div>

            <div className="question-why">
              <span className="why-label">为什么问这个</span>
              <p>{question.why}</p>
            </div>

            <div className="checklist">
              <span className="checklist-label">及格线</span>
              <ul>
                {question.checklist.map((item, i) => (
                  <li key={i}>
                    <span className="check-mark" aria-hidden="true">
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
