"use client";

import { useState } from "react";

import SoftSpotMap from "@/components/SoftSpotMap";
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
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark">预</span>
          <div className="brand-text">
            <h1>预答辩</h1>
            <p className="tagline">在你还能改的时候，告诉你哪儿会被问倒</p>
          </div>
        </div>
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
          <div className="report-head">
            <h2>软肋地图</h2>
            <p>
              横轴看「这个想法别人做过吗」，纵轴看「这条主张你答得上来吗」。
              落在右下角那几颗，就是最该改的。
            </p>
          </div>

          <SoftSpotMap claims={result.claims} />

          <p className="report-footnote">
            这张图用的是假数据，第 6 步起会换成你的真实提纲。
          </p>
        </section>
      )}
    </main>
  );
}
