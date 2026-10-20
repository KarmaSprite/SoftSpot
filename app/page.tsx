"use client";

import { useState } from "react";

import SoftSpotMap from "@/components/SoftSpotMap";
import ClaimTable from "@/components/ClaimTable";
import QuestionList from "@/components/QuestionList";
import type { AnalysisResult, Claim, Question } from "@/lib/types";

/**
 * /api/analyze 的响应体。
 *
 * 字段跟 app/api/analyze/route.ts 里 NextResponse.json({...}) 的返回一一对应。
 * 为什么不从这里 import 类型：route.ts 是服务端文件，它 export 的类型
 * 在客户端组件里 import 会把整个 route 模块拖进浏览器包。
 * 前后端之间传的本来就是一段 JSON，客户端自己声明"我期待收到什么"更诚实。
 */
type AnalyzeResponse = {
  claims: Claim[];
  questions: Question[];
  warnings: string[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    calls: number;
  };
  costYuan: number;
  model: string;
  scoresArePlaceholder: boolean;
  /**
   * 哪些主张这次没查成。
   *
   * 服务端在这些主张上填的 overlap 是 0，但那个 0 的意思是"不知道"，
   * 不是"没人做过"。客户端必须把它们单独摆出来，不能当 0 分画进图里。
   */
  blindClaimIds: string[];
  elapsedMs: number;
};

/** 报告顶部那一行元信息。跟主张、问题本身无关，所以单独存一份。 */
type Meta = {
  elapsedMs: number;
  costYuan: number;
  totalTokens: number;
  warnings: string[];
  scoresArePlaceholder: boolean;
  blindClaimIds: string[];
};

export default function Home() {
  const [outline, setOutline] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const count = outline.trim().length;
  const canSubmit = count > 0 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    /**
     * 开跑之前先把上一份报告清掉。
     *
     * 不清的话，用户贴了新提纲点按钮，会看到旧报告还挂在那儿，
     * 分不清"这是新的还是旧的"。等 30 秒的过程中他会以为已经分析完了。
     */
    setResult(null);
    setMeta(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline }),
      });

      /**
       * 先读 body 再判断状态码。
       *
       * 为什么不是先判断 res.ok：服务端出错时也会返回一段 JSON，
       * 里面带着人话错误说明（"还没配 key"、"提纲太短"之类）。
       * 直接按状态码 throw 掉，就把这段说明扔了，
       * 用户只会看到一个 "422 Unprocessable Entity"。
       */
      const data = (await res.json()) as AnalyzeResponse & { error?: string };

      if (!res.ok) {
        setError(data.error ?? `服务端返回了 ${res.status}，但没说是什么原因。`);
        return;
      }

      setResult({ claims: data.claims, questions: data.questions });
      setMeta({
        elapsedMs: data.elapsedMs,
        costYuan: data.costYuan,
        totalTokens: data.usage.totalTokens,
        warnings: data.warnings,
        scoresArePlaceholder: data.scoresArePlaceholder,
        /**
         * 老接口没有这个字段（第 13 步之前的响应里没有 blindClaimIds）。
         * 用 ?? [] 兜住：字段缺失时当作"全都查成了"，
         * 总比拿 undefined 去 .length 报错强。
         */
        blindClaimIds: data.blindClaimIds ?? [],
      });
    } catch (e) {
      /**
       * 走到这里说明请求根本没发出去，或者响应不是 JSON。
       * 最常见的原因是 dev server 那个窗口被关了 —— 所以文案里直接点出来。
       */
      const detail = e instanceof Error ? e.message : String(e);
      setError(
        `请求没发出去：${detail}\n检查一下跑 npm run dev 的那个窗口是不是还开着，以及终端里有没有报错。`,
      );
    } finally {
      setLoading(false);
    }
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
            {loading ? "正在分析…" : "开始诊断"}
          </button>
        </div>
      </section>

      {/* 分析中：告诉用户在等什么、要等多久，别让他以为卡死了 */}
      {loading && (
        <div className="alert alert-busy" role="status">
          <span className="spinner" aria-hidden="true" />
          <p className="alert-body">
            正在读你的提纲：先抽出主张，再逐条生成质询问题。大概 30 秒，这个页面别关。
          </p>
        </div>
      )}

      {/* 出错：原文照搬，因为服务端给的错误话是能照着改的 */}
      {error && (
        <div className="alert alert-error" role="alert">
          <strong className="alert-title">这一步没走通</strong>
          <p className="alert-body">{error}</p>
        </div>
      )}

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

          {/* 元信息：花了多久、多少钱。用 dl 而不是几个 span，因为这是"名称-数值"对 */}
          {meta && (
            <dl className="report-meta">
              <div>
                <dt>耗时</dt>
                <dd>{(meta.elapsedMs / 1000).toFixed(1)} 秒</dd>
              </div>
              <div>
                <dt>花费</dt>
                <dd>约 {meta.costYuan.toFixed(4)} 元</dd>
              </div>
              <div>
                <dt>token</dt>
                <dd>{meta.totalTokens.toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
          )}

          {/* 警告不阻断结果，所以用黄色而不是红色，而且放在报告最上面 */}
          {meta && meta.warnings.length > 0 && (
            <div className="alert alert-warn">
              <strong className="alert-title">
                有 {meta.warnings.length} 处要你自己确认
              </strong>
              <ul className="alert-list">
                {meta.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="report-head">
            <h3>软肋地图</h3>
            <p>
              横轴看「这个想法别人做过吗」，纵轴看「这条主张你答得上来吗」。
              落在右下角那几颗，就是最该改的。
            </p>
          </div>

          {/*
            placeholder：第 12 步接上检索之前，所有主张的分数都是 50。
            50 正好在分界线上，九个点会全部叠在正中心同一个位置，
            画出来像一个点，比不画更误导。所以这时候不画点，画说明。
          */}
          <SoftSpotMap
            claims={result.claims}
            placeholder={meta?.scoresArePlaceholder ?? false}
            blindClaimIds={meta?.blindClaimIds ?? []}
          />

          <div className="report-head">
            <h3>主张明细</h3>
            <p>
              把抽出来的主张摊开看。横条越长，说明别人做过的那部分越多，
              撞车的可能性越大。
            </p>
          </div>

          <ClaimTable
            claims={result.claims}
            placeholder={meta?.scoresArePlaceholder ?? false}
            blindClaimIds={meta?.blindClaimIds ?? []}
          />

          <div className="report-head">
            <h3>质询问题清单</h3>
            <p>
              按「你答不上来的概率」从高到低排。左边有红杠那几条，
              是老师最可能当场追问的。
            </p>
            {/*
              为什么这里必须说一句「问题不受影响」：
              用户会自己发现「地图说不知道、问题清单却说得斩钉截铁」，
              不说清楚他就会以为哪儿坏了。
              实际上问题的风险分来自「提纲自己有没有证据」，
              跟查没查到别人的论文完全无关 —— 这一点必须讲明白，
              否则用户会开始怀疑本来可信的东西。
            */}
            {(meta?.blindClaimIds.length ?? 0) > 0 && (
              <p className="report-note">
                有 {meta?.blindClaimIds.length} 条主张的查重没做成，但下面这些问题不受影响
                —— 问题是从你的提纲本身问出来的，跟查没查到别人的论文无关。
              </p>
            )}
          </div>

          <QuestionList questions={result.questions} />

          <p className="report-footnote">
            主张和问题都是 DeepSeek 逐条读你提纲得出的。
            {meta?.scoresArePlaceholder
              ? "地图上的两个分数还是占位值，等接上 arXiv 和 Crossref 才会有真实分数。"
              : ""}
          </p>
        </section>
      )}
    </main>
  );
}
