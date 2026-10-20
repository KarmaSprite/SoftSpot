"use client";

import { useCallback, useEffect, useState } from "react";

import SoftSpotMap from "@/components/SoftSpotMap";
import ClaimTable from "@/components/ClaimTable";
import QuestionList from "@/components/QuestionList";
import HomeGround from "@/components/HomeGround";
import ResetDialog from "@/components/ResetDialog";
import { SITE } from "@/lib/config";
import { parseManualRefs } from "@/lib/manual";
import { FILL_OUTLINE_EVENT } from "@/lib/samples";
import { INSTANT_SAMPLES, LOAD_INSTANT_EVENT } from "@/lib/samples-instant";
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
  /**
   * 你粘的中文文献，最后真的认出来几条。
   * 0 有两种可能：没粘，或者粘了但一条都没认出来 —— 后者要靠 warnings 区分。
   */
  manualRefCount: number;
  /** 这个功能当前开没开（站长开关）。服务端关了的话，前端传上去的内容会被忽略。 */
  manualRefsEnabled: boolean;
  /**
   * 每条主张的证据明细。
   *
   * 「你的主场」那一块在一条都没进的时候，要告诉用户
   * 离得最近的是哪一条、卡在哪个维度上 —— 那需要这个。
   * 字段形状对齐 route.ts 里 evidence 那一段。
   */
  evidence: EvidenceItem[];
  elapsedMs: number;
};

/** 一条主张的证据明细，跟 lib/nearest.ts 的 EvidenceLite 同形。 */
type EvidenceItem = {
  claimId: string;
  score: number;
  dimensions: { name: string; score: number; hits: string[] }[];
};

/** 报告顶部那一行元信息。跟主张、问题本身无关，所以单独存一份。 */
type Meta = {
  elapsedMs: number;
  costYuan: number;
  totalTokens: number;
  warnings: string[];
  scoresArePlaceholder: boolean;
  blindClaimIds: string[];
  manualRefCount: number;
  evidence: EvidenceItem[];
  /**
   * 这份报告是不是「离线示例」放出来的录像。
   *
   * 为什么要单独记一笔：录像里那个「耗时 38.1 秒、花费 0.0446 元」
   * 是当时真跑的花费，不是这一次的。不标出来，用户会以为刚刚花了这些钱。
   * 演示时可以含糊，报告本身不能含糊。
   */
  instantName: string | null;
};

export default function Home() {
  const [outline, setOutline] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const count = outline.trim().length;
  const canSubmit = count > 0 && !loading;

  /**
   * 出没出结果，决定页面是单栏还是两栏。
   *
   * 为什么用 result 判而不是单独一个 state：
   * 两栏是"有报告可看"这件事的结果，不是另一件需要同步的事。
   * 另立一个 state 就得在成功、失败、重跑三条路径上都记得改它，
   * 早晚有一条忘了改，页面会卡在两栏却没有报告。
   *
   * 为什么"正在分析"的时候不收拢：
   * 那时候还没有报告可以放右栏，收拢了右边是一块空白；
   * 而且收拢动画和转圈同时出现，用户会以为页面崩了。
   */
  const split = result !== null;

  /**
   * 边打字边数「认出来几条」。
   *
   * 用的是后端同一个函数（lib/manual.ts），不是前端另写一套 ——
   * 两套解析规则早晚会不一致，那时用户会看到「页面说 3 条，报告说 2 条」。
   *
   * 为什么只显示条数、不显示解析警告：
   * 打字的中间状态本来就「太短」（"中职导游"才 4 个字），
   * 每敲一个字弹一条"有 1 行太短"，用户会以为功能坏了。
   * 警告留到提交后，由服务端一次性告诉你。
   */
  const manualCount = parseManualRefs(manualText).refs.length;

  /**
   * 接调试面板那条「把这段提纲填进去」的消息。
   *
   * 为什么用 window 上的自定义事件而不是传 props：
   * 调试面板挂在 app/layout.tsx 上，输入框在 app/page.tsx 里，
   * 而 layout 是 page 的父组件 —— 想让它改 page 的 state 方向是反的，
   * 只能靠 context 或者全局状态。一个事件比这两样都轻：
   * 谁想填就 dispatch，谁想接就 listen，不用为了一个调试功能改动组件树。
   * 事件名和载荷类型是约定，所以两边共用 lib/samples.ts 里那个常量。
   *
   * 为什么只填空、不自动开始诊断：
   * 自动跑一次就是一次真花钱的模型调用（约 0.04 元），
   * 而用户点这个按钮的意图往往只是"我想看看这段提纲长什么样"。
   * 填完停在那儿，让他自己决定要不要花这个钱。
   */
  useEffect(() => {
    function onFill(event: Event) {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text !== "string" || text.length === 0) return;

      setOutline(text);
      setError(null);

      /*
        等 React 把新值写进 DOM 再把光标挪到末尾。
        不等的后果：textarea 里还是旧内容，setSelectionRange 会按旧长度定位，
        光标落在中间，用户接着打字就插进正文里了。
      */
      requestAnimationFrame(() => {
        const el = document.getElementById("outline");
        if (el instanceof HTMLTextAreaElement) {
          el.focus();
          el.setSelectionRange(text.length, text.length);
        }
      });
    }

    window.addEventListener(FILL_OUTLINE_EVENT, onFill);
    return () => window.removeEventListener(FILL_OUTLINE_EVENT, onFill);
  }, []);

  /**
   * 接「把这份离线结果直接摆出来」这条消息。
   *
   * 为什么不走 handleSubmit：
   * 走一遍请求才是真花钱的那条路，而离线示例的全部意义是"不花钱、不等"。
   * 这里直接把存好的响应摊进 state，跟真响应走的是同一套渲染。
   *
   * 为什么把 loading 也清掉：
   * 用户可能在上一次真跑还没回来的时候点了这个按钮。
   * 不清的话，转圈会一直在，报告却已经换成了录像，看起来像卡住了。
   */
  useEffect(() => {
    function onLoad(event: Event) {
      const index = (event as CustomEvent<number>).detail;
      const sample = INSTANT_SAMPLES[index];
      if (!sample) return;

      const { payload } = sample;

      setLoading(false);
      setError(null);
      setOutline(sample.outline);
      setResult({ claims: payload.claims, questions: payload.questions });
      setMeta({
        elapsedMs: payload.elapsedMs,
        costYuan: payload.costYuan,
        totalTokens: payload.usage.totalTokens,
        warnings: payload.warnings,
        scoresArePlaceholder: payload.scoresArePlaceholder,
        blindClaimIds: payload.blindClaimIds,
        manualRefCount: payload.manualRefCount,
        evidence: payload.evidence,
        instantName: sample.name,
      });

      // 结果在页面下方，把视线带过去 —— 不然用户点完按钮看不到任何变化
      requestAnimationFrame(() => {
        document.querySelector(".report")?.scrollIntoView({ block: "start" });
      });
    }

    window.addEventListener(LOAD_INSTANT_EVENT, onLoad);
    return () => window.removeEventListener(LOAD_INSTANT_EVENT, onLoad);
  }, []);

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
        body: JSON.stringify({
          outline,
          /**
           * 开关关掉时传空串，而不是不传这个字段。
           *
           * 后端本来也会忽略（它自己判一次开关），这里再判一次是为了
           * 「前端藏起来的东西不会被顺手带上去」—— 少一条能解释清楚的路径。
           */
          manualRefs: SITE.manualRefs ? manualText : "",
        }),
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
        manualRefCount: data.manualRefCount ?? 0,
        /**
         * 证据明细同样用 ?? [] 兜住。
         * 拿不到的时候「离主场最近的一条」会退回一句笼统的建议，
         * 不会编一个维度名出来。
         */
        evidence: data.evidence ?? [],
        /**
         * 真跑出来的报告，没有录像来源。
         * 上一次如果是点离线示例看的，这里必须清掉，
         * 否则真报告顶上还挂着「这是存好的结果」，那才是假话。
         */
        instantName: null,
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

  /**
   * 回到输入页，但提纲留着。
   *
   * 为什么不顺手清空提纲：
   * 点「重新编辑」的人十有八九是「这一条我想改几个字再跑一遍」。
   * 清空的话他得重新粘一遍，那这个按钮就等于「从头再来」，
   * 而「从头再来」是另一个按钮（重置）的事 —— 两个按钮必须干不同的事，
   * 否则用户永远不知道该点哪个。
   */
  function handleReedit() {
    setResult(null);
    setMeta(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * 真的清空。
   *
   * 这里连 outline 和 manualText 一起清 —— 这是它和「重新编辑」唯一的区别，
   * 也是为什么它必须先过一个确认弹层。
   */
  function handleReset() {
    setOutline("");
    setManualText("");
    setManualOpen(false);
    setResult(null);
    setMeta(null);
    setError(null);
    setResetOpen(false);
    window.scrollTo({ top: 0 });
  }

  /**
   * 取消回调要稳定。
   *
   * ResetDialog 的 keydown 监听依赖 onCancel 这个引用，
   * 每次渲染都给一个新函数的话，那个 useEffect 会反复解绑重绑 ——
   * 功能上没错，但按 Esc 的瞬间如果正赶上重绑，那一下就丢了。
   * useCallback 让它整个生命周期里只有一份。
   */
  const closeReset = useCallback(() => setResetOpen(false), []);

  return (
    <main className={split ? "shell shell-wide" : "shell"}>
      {/*
        页头没有图标方块。
        「深色圆角方块里放一个汉字」这种写法换成任何产品名都成立，
        说明它不传达信息，只是模板残留。这里用纯文字 + 一条细线。
      */}
      <header className="masthead">
        <h1>预答辩</h1>
        <p className="tagline">在你还能改的时候，告诉你哪儿会被问倒</p>
      </header>

      {/*
        结果页顶部的固定条：左边是折起来的提纲摘要，右边是三个动作。

        为什么输入卡片要整个消失（连 DOM 都不渲染），而不是收成一小条：
        一份报告有五六屏长，用户往下读的时候，顶上永远压着一个输入框，
        会一直有种「我是不是还没提交」的错觉。收起来不是藏起来，
        是承认「这一步已经做完了」—— 想看自己贴了什么，点摘要展开就行。

        为什么摘要用原生 <details>：
        不用写 state、不用管开合动画，键盘能 Tab 到、能回车展开，
        读屏软件默认就会念成「可折叠」。手写一个折叠面板要补的就是这几样。
      */}
      {split && (
        <div className="result-bar no-print">
          <details className="outline-brief">
            <summary>
              提纲摘要 · 共 {count} 字
            </summary>
            <p>{outline}</p>
          </details>

          <div className="result-actions">
            <button type="button" className="result-btn" onClick={handleReedit}>
              重新编辑
            </button>
            <button
              type="button"
              className="result-btn"
              onClick={() => window.print()}
            >
              存成 PDF
            </button>
            <button
              type="button"
              className="result-btn is-danger"
              onClick={() => setResetOpen(true)}
            >
              重置
            </button>
          </div>
        </div>
      )}

      {/*
        workbench 是两栏的容器。
        没结果时它就是一个普通块，里面只有输入面板 —— 看起来和单栏一模一样。
        有结果时挂上 is-split，CSS 把它变成网格。

        为什么 DOM 顺序是「面板 → 报告 → 地图 → 通栏两块」：
        窄屏和打印时没有网格，元素就按 DOM 顺序竖着排。
        这个顺序正好是「先看我贴了什么，再看结论，再看图」，
        不用写任何 order 去掰 —— order 只改视觉，不改读屏和 Tab 的顺序，
        两边对不上比排版难看严重得多。
      */}
      <div className={split ? "workbench is-split" : "workbench"}>
        {/*
          输入面板只在还没出结果时渲染。

          为什么是「不渲染」而不是「display: none」：
          出结果之后这一整块就没有用了，留在 DOM 里的话，
          Tab 键还会走进去、读屏还会念出来、打印样式还得单独再藏一次。
          用条件渲染，这三件事一起消失，代码上也一眼能看出「结果页没有输入框」。
        */}
        {!split && (
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
            placeholder="例：本研究针对本科教育学专业「课程与教学论」课程中混合式教学停留于形式叠加的问题，拟采用准实验设计，检验学习投入在教学设计与学业表现之间的中介效应……"
            spellCheck={false}
          />

          {/*
            手工文献入口。
            整个块用 SITE.manualRefs 包着：开关一关，这里连 DOM 都不渲染，
            页面上不会留下一个空壳。
          */}
          {SITE.manualRefs && (
            <div className="manual-panel">
              <button
                type="button"
                className="manual-toggle"
                onClick={() => setManualOpen((v) => !v)}
                aria-expanded={manualOpen}
                aria-controls="manual-refs"
              >
                <span className="manual-toggle-mark" aria-hidden="true">
                  {manualOpen ? "−" : "+"}
                </span>
                已经有中文文献了？粘进来一起算
                {/*
                  收起状态下把条数露在外面，是为了让"我粘过了"这件事一直可见。
                  不然用户收起面板跑一次，回来会怀疑自己到底粘没粘。
                */}
                {!manualOpen && manualCount > 0 && (
                  <span className="manual-badge">{manualCount} 条</span>
                )}
              </button>

              {manualOpen && (
                <div className="manual-body">
                  <p className="manual-hint">
                    一行一条。标题和期刊用逗号隔开就行，年份写不写都认。
                    这些文献只用来回答「这个想法别人做过吗」，不参与「你答不答得上」。
                  </p>
                  <textarea
                    id="manual-refs"
                    className="manual-textarea"
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder={
                      "例：\n短视频教学在中职旅游专业中的应用, 中国职业技术教育, 2023\n中职导游专业普通话表达训练研究, 职业教育研究, 2022"
                    }
                    spellCheck={false}
                    rows={6}
                  />
                  <p
                    className={
                      manualCount > 0 ? "manual-count manual-count-on" : "manual-count"
                    }
                  >
                    {manualCount > 0
                      ? `已识别 ${manualCount} 条`
                      : "还没认出文献。一行一条，标题至少 6 个字。"}
                  </p>
                </div>
              )}
            </div>
          )}

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
        )}

        {/*
          右栏第一块：结论。
          只放"你有几条站得住"和它的理由，不放地图 ——
          地图是给眼睛看的，结论是给脑子看的，两栏分开摆才不打架。
        */}
        {result && (
          <section className="report">
            {/*
              报告区两级标题：
              h2 是「这是一份报告」，h3 是报告里的各个板块。
              以前板块都是 h2，和页面标题同级，屏幕阅读器读起来是平的。
            */}
            {/*
              这里原来有一个「存成 PDF」按钮，现在挪到页面顶部的 result-bar 里了。
              为什么不留着：同一个动作在同一个屏幕上出现两次，
              用户会以为它们是两件事（比如一个存摘要、一个存全文），
              于是两个都点一遍，然后发现一样 —— 这种疑惑没有任何收益。
            */}
            <div className="report-top">
              <h2 className="report-title">诊断报告</h2>
            </div>
            <p className="report-lede">
              共抽出 {result.claims.length} 条主张、{result.questions.length}{" "}
              个问题。先看哪些是你站得住的地方，再看哪几条最危险。
            </p>

            {/*
              录像要自报家门。
              下面那行「耗时 38.1 秒 / 花费 0.0446 元」是当时真跑花的钱，
              不是这一次的。不写清楚，用户会以为刚点一下又花了四分钱。
              用中性灰的小字，不用警告色 —— 这不是错误，只是需要说清楚。
            */}
            {meta?.instantName && (
              <p className="report-instant">
                这份报告是存好的示例结果（{meta.instantName}），不是刚刚算的。
                下面的耗时和花费是当时真跑一次的记录。
              </p>
            )}

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
                {/*
                  只在真认出来东西时才显示这一格。
                  粘了 3 行认出 0 条，这里显示"0 条"等于给用户一个"我失败了"的结论，
                  而真正的原因（标题太短 / 格式不对）在下面的黄色警告里说。
                */}
                {meta.manualRefCount > 0 && (
                  <div>
                    <dt>你粘的文献</dt>
                    <dd>{meta.manualRefCount} 条</dd>
                  </div>
                )}
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

            {/*
              主场放在最上面，而且放在地图上面。
              滚动顺序就是阅读顺序：先看到「你有两条站得住」，
              再看「哪三条最危险」，他才有力气看下去。
            */}
            <HomeGround
              claims={result.claims}
              blindClaimIds={meta?.blindClaimIds ?? []}
              placeholder={meta?.scoresArePlaceholder ?? false}
              evidence={meta?.evidence ?? []}
            />
          </section>
        )}

        {/*
          左栏第二块：软肋地图。
          它在地图在 DOM 里排在报告后面，网格把它摆回左边 ——
          宽屏上「输入 + 地图」是一列，窄屏上它排在结论后面，
          两种顺序都说得通，所以不需要 order。
        */}
        {result && (
          <div className="workbench-map">
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
          </div>
        )}

        {/*
          下面两块通栏，不塞进右栏。
          主张表有五列，问题清单一条就是一整段，
          挤进 700px 的右栏会变成细长条，读起来比单栏还累。
        */}
        {result && (
          <div className="workbench-wide">
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
          </div>
        )}

        {result && (
          <div className="workbench-wide">
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
          </div>
        )}
      </div>

      {/*
        提示条放在 workbench 外面。
        它们只在"还没有结果"的时候出现（跑的时候 result 是 null，
        出错时 result 也被清空了），而那时候还没有网格，
        摆在容器后面就是摆在输入框正下方，和以前一样。
      */}
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

      {/*
        三步骤说明只给第一次用的人看。
        出了报告还挂在页面上，等于占着最值钱的位置讲一件已经发生完的事。
      */}
      {!result && (
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
      )}

      {/*
        脚注跟着整份文档走，所以留在 workbench 外面。
        放进任何一栏都会变成"这一栏的注解"，而它说的是整份报告。
      */}
      {result && (
        <p className="report-footnote">
          主张和问题都是 DeepSeek 逐条读你提纲得出的。
          {meta?.scoresArePlaceholder
            ? "地图上的两个分数还是占位值，等接上 arXiv 和 Crossref 才会有真实分数。"
            : ""}
        </p>
      )}

      {/*
        确认弹层挂在 main 的最后。
        它自己是 position: fixed，挂在哪儿都行 ——
        放最后是因为它逻辑上属于「这一页的最后一个动作」，
        写在前面的话，读代码时会在读内容之前先撞上一段模态逻辑。
      */}
      <ResetDialog
        open={resetOpen}
        onCancel={closeReset}
        onConfirm={handleReset}
      />
    </main>
  );
}
