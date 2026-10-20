"use client";

/**
 * 调试面板。
 *
 * 为什么自己做一个：
 * Next.js 自带的那个按钮，文案写死在打包好的 bundle 里（"Open Next.js Dev Tools"），
 * 翻遍 node_modules/next/dist/client 找不到任何 i18n 入口，只能留、挪位置、或者关掉。
 * 我们要中文，就只能关掉它自己做一个。
 *
 * 为什么要比原版多东西：
 * 原版只能看渲染模式和路由，看不到"这台机器的 key 配了没有"。
 * 从第 5 步开始要花真钱调模型，key 没配好只会得到一个 401，
 * 到时候得猜是网络、key、还是代码的问题。把这个信息放到眼前，少一轮瞎猜。
 *
 * 为什么按钮能拖：
 * 固定在一个角会压住内容 —— 左下角压住步骤说明，右下角压住脚注。
 * 干脆让它能被拖到任何位置，坐标记在 localStorage 里，下次打开还在那儿。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  THEME_LABEL,
  THEME_MODES,
  applyTheme,
  readTheme,
  saveTheme,
  type ThemeMode,
} from "@/lib/theme";
import { SAMPLE_OUTLINES, randomOutline, requestFillOutline } from "@/lib/samples";
import { INSTANT_SAMPLES, requestInstantResult } from "@/lib/samples-instant";

/* ---------- 类型 ---------- */

type Health = {
  keyConfigured: boolean;
  keyLength: number;
  warnings: string[];
  model: string;
};

type RouteEntry = {
  path: string;
  files: string[];
};

type DevInfo = {
  nodeEnv: string;
  turbopack: boolean;
  nextVersion: string;
  nodeVersion: string;
  routes: RouteEntry[];
};

type Status = "idle" | "loading" | "ok" | "warn" | "error";

type Pos = { x: number; y: number };

/* ---------- 常量 ---------- */

const POS_KEY = "pre-defense-debug-pos";
const HIDDEN_KEY = "pre-defense-debug-hidden";
const SIZE_KEY = "pre-defense-debug-size";

/** 按钮直径，跟 CSS 里的 .dbg-btn 宽高必须一致，否则贴边计算会差几个像素。 */
const BTN_SIZE = 40;
/** 离屏幕边缘的最小距离，拖到边上也不会贴死。 */
const EDGE = 12;
/** 位移超过这个距离才算"拖动"，否则算"点击"。手指点击时也会有 1-2px 抖动。 */
const DRAG_THRESHOLD = 4;

const STATUS_TEXT: Record<Status, string> = {
  idle: "未检测",
  loading: "检测中",
  ok: "正常",
  warn: "有告警",
  error: "连不上",
};

const SIZES = [
  { value: "compact", label: "紧凑" },
  { value: "normal", label: "标准" },
  { value: "roomy", label: "宽松" },
] as const;

type Size = (typeof SIZES)[number]["value"];

function isSize(value: unknown): value is Size {
  return SIZES.some((s) => s.value === value);
}

/* ---------- 存取位置 ---------- */

/**
 * 把坐标夹回屏幕内。
 * 为什么必须夹：用户可能昨天在 27 寸显示器上把按钮拖到右下角，
 * 今天换笔记本打开，那个坐标在屏幕外，按钮就再也点不到了。
 */
function clampPos(x: number, y: number): Pos {
  const maxX = Math.max(EDGE, window.innerWidth - BTN_SIZE - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - BTN_SIZE - EDGE);
  return {
    x: Math.min(Math.max(x, EDGE), maxX),
    y: Math.min(Math.max(y, EDGE), maxY),
  };
}

function readPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return clampPos(parsed.x, parsed.y);
  } catch {
    return null;
  }
}

function readHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function readSize(): Size {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    return isSize(raw) ? raw : "normal";
  } catch {
    return "normal";
  }
}

/* ---------- 组件 ---------- */

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [health, setHealth] = useState<Health | null>(null);
  const [devInfo, setDevInfo] = useState<DevInfo | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [theme, setTheme] = useState<ThemeMode>("auto");
  const [size, setSize] = useState<Size>("normal");
  const [hidden, setHidden] = useState(false);

  const [pos, setPos] = useState<Pos | null>(null);
  /** 面板往上弹还是往下弹、往左对齐还是往右对齐 */
  const [up, setUp] = useState(true);
  const [alignRight, setAlignRight] = useState(false);

  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState("");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  /** 拖动过程中的临时数据。用 ref 不用 state，因为改它不该触发重渲染。 */
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  /** 拖动过程中最新的坐标。pointerup 里读它，避免拿到旧闭包里的 pos。 */
  const posRef = useRef<Pos | null>(null);

  /* ---------- 读设置 ---------- */

  useEffect(() => {
    setPos(readPos());
    setSize(readSize());
    setHidden(readHidden());
    const saved = readTheme();
    setTheme(saved);
    // 挂载时再落一次：万一有人绕过布局里那段脚本直接进来，这里兜底。
    applyTheme(saved);
  }, []);

  /* ---------- 检测 ---------- */

  const check = useCallback(async () => {
    setStatus("loading");
    const started = Date.now();

    try {
      // 两个接口并行发。它们互不依赖，串行等只是白等。
      const [hRes, dRes] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }),
        fetch("/api/dev-info", { cache: "no-store" }),
      ]);

      if (!hRes.ok) throw new Error(`健康检查返回 ${hRes.status}`);

      const h = (await hRes.json()) as Health;
      setHealth(h);
      setElapsed(Date.now() - started);
      setError("");

      // dev-info 挂了不该让整块面板变成"连不上"，它是加餐，失败就显示横杠。
      if (dRes.ok) {
        setDevInfo((await dRes.json()) as DevInfo);
      } else {
        setDevInfo(null);
      }

      /*
        状态点只有三种颜色，但这里有四种情况：
        key 没配、key 配了但有告警、一切正常、请求失败。
        "没配"和"有告警"都算黄灯 —— 它们都表示"现在点分析会出问题"，
        区别在面板里的文字，不该让用户去分辨两种黄。
      */
      const bad = !h.keyConfigured || h.warnings.length > 0;
      setStatus(bad ? "warn" : "ok");
    } catch (err) {
      setStatus("error");
      setElapsed(Date.now() - started);
      setError(err instanceof Error ? err.message : "连不上");
    }
  }, []);

  // 挂载时探一次
  useEffect(() => {
    void check();
  }, [check]);

  // 每次打开都重探：key 是刚填的、服务是刚重启的，这些都不该要求用户手动刷新
  useEffect(() => {
    if (open) void check();
  }, [open, check]);

  /* ---------- 窗口变化 ---------- */

  useEffect(() => {
    function onResize() {
      setPos((current) => (current ? clampPos(current.x, current.y) : current));
      if (open) updatePlacement();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // updatePlacement 是稳定的（只读 ref + setState），不用进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* ---------- 面板朝哪边弹 ---------- */

  function updatePlacement() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 按钮在下半屏就往上弹，在上半屏就往下弹。不然面板会顶出屏幕。
    setUp(rect.top > window.innerHeight / 2);
    // 按钮在右半屏就右对齐，否则面板会从右边溢出
    setAlignRight(rect.left > window.innerWidth / 2);
  }

  function toggle() {
    if (!open) updatePlacement();
    setOpen((v) => !v);
  }

  /* ---------- 拖动 ---------- */

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    posRef.current = { x: rect.left, y: rect.top };
    /*
      捕获指针：手指/鼠标滑出按钮外面，move 和 up 事件仍然打到这个按钮上。
      包 try/catch 是因为 pointerId 不一定是活的 —— 自动化测试里手动 dispatch
      的事件、或者指针已经被系统收走的情况，这里会抛 NotFoundError。
      捕获失败顶多是拖到按钮外面就断了，不该让整个面板崩掉。
    */
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 捕获不到就退化成普通拖动，仍然能用
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    // 阈值判断只做一次：一旦认定是拖动，后面就不再回头当点击
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      setOpen(false);
    }
    if (!drag.moved) return;

    const next = clampPos(drag.originX + dx, drag.originY + dy);
    posRef.current = next;
    setPos(next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // 没捕获成功过，这里自然也没得释放
    }

    if (!drag) return;

    if (drag.moved) {
      // 拖完记住位置。存不进去不影响这一次，所以吞掉异常。
      const final = posRef.current;
      if (final) {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(final));
        } catch {
          // 隐私模式下写不进去，忽略
        }
      }
      return;
    }

    // 没移动 = 点击
    toggle();
  }

  /* ---------- 主题与大小 ---------- */

  function chooseTheme(mode: ThemeMode) {
    setTheme(mode);
    applyTheme(mode);
    saveTheme(mode);
  }

  function chooseSize(next: Size) {
    setSize(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      // 同上，存不下就算了
    }
  }

  /* ---------- 隐藏与唤回 ---------- */

  function hideForSession() {
    setHidden(true);
    setOpen(false);
    try {
      sessionStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // 存不下就只是这次隐藏，刷新会回来，也不算坏
    }
  }

  /*
    隐藏之后按钮没了，必须有办法叫回来，否则只能关掉标签页。
    用 Shift + D，并且在打字的时候不拦 —— 否则在输入框里想打大写 D 会被吃掉。
  */
  useEffect(() => {
    if (!hidden) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "D" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      setHidden(false);
      try {
        sessionStorage.removeItem(HIDDEN_KEY);
      } catch {
        // 忽略
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hidden]);

  /* ---------- 重启开发服务器 ---------- */

  async function restart() {
    setRestarting(true);
    setRestartMsg("正在重启…");

    try {
      /*
        /__nextjs_restart_dev 是 Next 开发服务器自己开的端点（实测 POST 返回 204）。
        它不是公开 API，升级 Next 大版本有可能消失 —— 所以失败只显示一行字，
        不影响面板其它部分，也不该让页面白屏。
      */
      const res = await fetch("/__nextjs_restart_dev", { method: "POST" });
      if (!res.ok) throw new Error(`重启端点返回 ${res.status}`);

      /*
        重启过程中服务会短暂断开，立刻请求大概率失败。
        所以不是"请求一次看结果"，而是"每 250ms 敲一次门，敲开为止"，最多等 10 秒。
      */
      let alive = false;
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        try {
          const ping = await fetch("/api/health", { cache: "no-store" });
          if (ping.ok) {
            alive = true;
            break;
          }
        } catch {
          // 还没起来，继续等
        }
      }

      setRestartMsg(alive ? "已重启" : "重启超时，去看终端");
      await check();
    } catch (err) {
      setRestartMsg(err instanceof Error ? err.message : "重启失败");
    } finally {
      setRestarting(false);
    }
  }

  /* ---------- 生产环境直接不渲染 ---------- */

  /*
    这行必须在所有 hook 之后。
    React 要求每次渲染调用的 hook 数量和顺序完全一致，
    如果把这行挪到上面，开发模式会渲染出 15 个 hook、生产模式渲染 0 个，
    两者对比就会报 "Rendered fewer hooks than expected"。
  */
  if (process.env.NODE_ENV === "production") return null;
  if (hidden) return null;

  /* ---------- 样式 ---------- */

  /*
    没拖过的时候不写死坐标，用 CSS 的 left / bottom 定位。
    原因：写死坐标就得在渲染时读 window.innerHeight，那是服务端没有的东西，
    会直接导致水合不匹配。
  */
  const rootStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: EDGE, bottom: EDGE };

  const keyText = health
    ? health.keyConfigured
      ? `已配置 · ${health.keyLength} 位`
      : "未配置"
    : "—";

  const keyClass = health
    ? health.keyConfigured
      ? health.warnings.length > 0
        ? "dbg-val dbg-val-warn"
        : "dbg-val dbg-val-ok"
      : "dbg-val dbg-val-warn"
    : "dbg-val";

  return (
    <div className="dbg-root no-print" ref={rootRef} style={rootStyle}>
      {open && (
        <div
          className={[
            "dbg-panel",
            up ? "dbg-up" : "dbg-down",
            alignRight ? "dbg-right" : "dbg-left",
            `dbg-size-${size}`,
          ].join(" ")}
          role="dialog"
          aria-label="调试面板"
        >
          <div className="dbg-head">
            <span className="dbg-head-title">调试面板</span>
            <span className="dbg-head-status">
              <i className={`dbg-dot dbg-dot-${status}`} />
              {STATUS_TEXT[status]}
            </span>
            <button
              type="button"
              className="dbg-close"
              onClick={() => setOpen(false)}
              aria-label="关闭调试面板"
            >
              ×
            </button>
          </div>

          {/* ----- 状态 ----- */}
          <div className="dbg-group">
            <span className="dbg-group-title">状态</span>

            <div className="dbg-row">
              <span className="dbg-key">运行模式</span>
              <span className="dbg-val">
                {devInfo
                  ? devInfo.nodeEnv === "development"
                    ? "开发模式"
                    : devInfo.nodeEnv
                  : "—"}
              </span>
            </div>

            <div className="dbg-row">
              <span className="dbg-key">API Key</span>
              <span className={keyClass}>{keyText}</span>
            </div>

            <div className="dbg-row">
              <span className="dbg-key">模型</span>
              <span className="dbg-val">{health?.model ?? "—"}</span>
            </div>

            <div className="dbg-row">
              <span className="dbg-key">检测耗时</span>
              <span className="dbg-val">
                {elapsed === null ? "—" : `${elapsed} ms`}
              </span>
            </div>
          </div>

          {health && health.warnings.length > 0 && (
            <div className="dbg-warn">
              <span className="dbg-warn-title">key 可能有问题</span>
              <ul>
                {health.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="dbg-warn">
              <span className="dbg-warn-title">检测失败</span>
              <ul>
                <li>{error}</li>
              </ul>
            </div>
          )}

          {/* ----- 外观 ----- */}
          <div className="dbg-group">
            <span className="dbg-group-title">外观</span>

            <div className="dbg-row">
              <span className="dbg-key">主题</span>
              <span className="dbg-seg">
                {THEME_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`dbg-seg-btn${theme === mode ? " is-on" : ""}`}
                    onClick={() => chooseTheme(mode)}
                    aria-pressed={theme === mode}
                  >
                    {THEME_LABEL[mode]}
                  </button>
                ))}
              </span>
            </div>

            <div className="dbg-row">
              <span className="dbg-key">大小</span>
              <span className="dbg-seg">
                {SIZES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`dbg-seg-btn${size === item.value ? " is-on" : ""}`}
                    onClick={() => chooseSize(item.value)}
                    aria-pressed={size === item.value}
                  >
                    {item.label}
                  </button>
                ))}
              </span>
            </div>
          </div>

          {/* ----- 路由 ----- */}
          <div className="dbg-group">
            <span className="dbg-group-title">路由</span>

            <div className="dbg-row">
              <span className="dbg-key">打包器</span>
              <span className="dbg-val">
                {devInfo ? (devInfo.turbopack ? "Turbopack" : "Webpack") : "—"}
              </span>
            </div>

            <div className="dbg-row">
              <span className="dbg-key">Next</span>
              <span className="dbg-val">{devInfo?.nextVersion ?? "—"}</span>
            </div>

            <div className="dbg-row">
              <span className="dbg-key">Node</span>
              <span className="dbg-val">{devInfo?.nodeVersion ?? "—"}</span>
            </div>

            {devInfo && devInfo.routes.length > 0 && (
              <ul className="dbg-tree">
                {devInfo.routes.map((route) => (
                  <li key={route.path} className="dbg-tree-row">
                    <code className="dbg-tree-path">{route.path}</code>
                    <span className="dbg-tree-files">
                      {route.files.map((file) => (
                        <span key={file} className="dbg-tree-file">
                          {file}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ----- 测试数据 ----- */}
          <div className="dbg-group">
            <span className="dbg-group-title">测试数据</span>

            {SAMPLE_OUTLINES.map((sample) => (
              <button
                key={sample.name}
                type="button"
                className={`dbg-action dbg-action-sample dbg-action-scored dbg-action-q${sample.quality}`}
                onClick={() => requestFillOutline(sample.text)}
                title={sample.note}
              >
                <span className="dbg-action-quality">{sample.quality}</span>
                <span>{sample.name}</span>
              </button>
            ))}

            <button
              type="button"
              className="dbg-action dbg-action-sample"
              onClick={() => requestFillOutline(randomOutline())}
            >
              随机凑一段
            </button>

            <p className="dbg-note">
              左边那个数是这份提纲的整体质量分：样本量、方法名、出处、
              干预轮次这些支撑结论的东西，写清楚了没有。数字是人工标的，
              标完都用真模型跑过一遍，跟报告里的纵轴对得上。
              点一下只填进输入框，不会自动开始诊断 —— 连点「随机凑一段」
              每次都不一样，用来验证「文字通顺但没证据」的提纲不会被夸成好选题。
            </p>
          </div>

          {/* ----- 离线示例 ----- */}
          <div className="dbg-group">
            <span className="dbg-group-title">离线示例</span>

            {INSTANT_SAMPLES.map((sample, index) => (
              <button
                key={sample.name}
                type="button"
                className={`dbg-action dbg-action-sample dbg-action-scored dbg-action-q${sample.quality} dbg-action-instant`}
                onClick={() => requestInstantResult(index)}
                title={sample.note}
              >
                <span className="dbg-action-quality">{sample.quality}</span>
                <span>{sample.name}</span>
              </button>
            ))}

            <p className="dbg-note">
              上面这两条是真跑过一遍、把结果存下来的 —— 点一下直接出报告，
              不联网、不花钱、不用等 30 秒。数据是 2026-10-20 用 deepseek-chat
              跑出来的原样，耗时和花费照实显示，别把它当成刚算的。
              第一条能跑出「你的主场」，第二条满屏红点，正好对比着看。
            </p>
          </div>

          {/* ----- 开发 ----- */}
          <div className="dbg-group">
            <span className="dbg-group-title">开发</span>

            <button
              type="button"
              className="dbg-action"
              onClick={() => void restart()}
              disabled={restarting}
            >
              {restarting ? "正在重启…" : "重启开发服务器"}
            </button>
            {restartMsg && <p className="dbg-note">{restartMsg}</p>}

            <button
              type="button"
              className="dbg-action"
              onClick={() => void check()}
              disabled={status === "loading"}
            >
              重新检测
            </button>

            <button type="button" className="dbg-action" onClick={hideForSession}>
              本次会话隐藏
            </button>
            <p className="dbg-note">隐藏之后按 Shift + D 可以叫回来。</p>
          </div>
        </div>
      )}

      <button
        type="button"
        ref={btnRef}
        className="dbg-btn"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          /*
            点击和拖动的判定在 pointerup 里做完了，这里必须拦掉。
            否则拖完松手时浏览器还会补发一个 click，面板会"啪"地弹出来。
          */
          e.preventDefault();
        }}
        aria-label={open ? "收起调试面板" : "打开调试面板"}
        aria-expanded={open}
        title={`调试 · ${STATUS_TEXT[status]}（可拖动）`}
      >
        <span className="dbg-icon" aria-hidden="true">
          &gt;_
        </span>
        <i className={`dbg-dot dbg-dot-${status}`} />
      </button>
    </div>
  );
}
