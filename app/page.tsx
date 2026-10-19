"use client";

import { useState } from "react";

import SoftSpotMap from "@/components/SoftSpotMap";
import ClaimTable from "@/components/ClaimTable";
import QuestionList from "@/components/QuestionList";
import { MOCK_RESULT } from "@/lib/mock";
import type { AnalysisResult } from "@/lib/types";

export default function Home() {
  const [outline, setOutline] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const count = outline.trim().length;
  const canSubmit = count > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    // 第 3b 步：先灌假数据，只为把界面画出来。
    // 第 6 步起这里会换成 fetch("/api/analyze")。
    setResult(MOCK_RESULT);
  }

  return (
    <main className="shell">
      {/*
        页头没有图标方块。
        「深色圆角方块里放一个汉字」这种写法换成任何产品名都成立，
        说明它不传达信息，只是模板残留。这里用纯文字 + 一条细线。
      */}
      <header className="masthead">
        <h1>预答辩</h1>
        <p className="tagline">在你还能改的时候，告诉你哪儿会被问倒</p>
      </header>

      <section className="panel">
        <label className="panel-label" htmlFor="outline">
          把你的开题提纲贴进来
          <span className="panel-hint">
            选题背景、研究问题、技术路线、预期成果，有多少贴多少
          </span>
        </label>

        <textarea
          id="outline"
          className="outline-input"
          value={outline}
          onChange={(e) => setOutline(e.target.value)}
          placeholder="例：本研究针对高职院校学生英语口语练习机会不足的问题，拟采用大语言模型构建一个随时可用的对话陪练系统，通过语音识别与生成技术实现实时纠错……"
          spellCheck={false}
        />

        <div className="panel-foot">
          <span className="counter">
            已输入 <strong>{count}</strong> 字
          </span>
          <button
            type="button"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            开始诊断
          </button>
        </div>
      </section>

      <section className="next-steps">
        <h2>点下去之后会发生什么</h2>
        <ol>
          <li>
            <span className="step-no">1</span>
            抽出你的核心主张，分成「问题 / 方法 / 预期」三类
          </li>
          <li>
            <span className="step-no">2</span>
            去 arXiv 和 Crossref 查这些想法别人做过没有
          </li>
          <li>
            <span className="step-no">3</span>
            画一张软肋地图，再按危险程度排一份质询问题清单
          </li>
        </ol>
      </section>

      {result && (
        <section className="report">
          {/*
            报告区两级标题：
            h2 是「这是一份报告」，h3 是报告里的三个板块。
            以前三个板块都是 h2，和页面标题同级，屏幕阅读器读起来是平的。
          */}
          <h2 className="report-title">诊断报告</h2>
          <p className="report-lede">
            共抽出 {result.claims.length} 条主张、{result.questions.length}{" "}
            个问题。先看地图找最危险的那几条，再看明细和问题清单。
          </p>

          <div className="report-head">
            <h3>软肋地图</h3>
            <p>
              横轴看「这个想法别人做过吗」，纵轴看「这条主张你答得上来吗」。
              落在右下角那几颗，就是最该改的。
            </p>
          </div>

          <SoftSpotMap claims={result.claims} />

          <div className="report-head">
            <h3>主张明细</h3>
            <p>
              把抽出来的主张摊开看。横条越长，说明别人做过的那部分越多，
              撞车的可能性越大。
            </p>
          </div>

          <ClaimTable claims={result.claims} />

          <div className="report-head">
            <h3>质询问题清单</h3>
            <p>
              按「你答不上来的概率」从高到低排。左边有红杠那几条，
              是老师最可能当场追问的。
            </p>
          </div>

          <QuestionList questions={result.questions} />

          <p className="report-footnote">
            这份报告用的是假数据，第 6 步起会换成你的真实提纲。
          </p>
        </section>
      )}
    </main>
  );
}
