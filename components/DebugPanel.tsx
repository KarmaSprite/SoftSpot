"use client";

/**
 * 调试面板：替代 Next.js 自带的那个英文按钮。
 *
 * 为什么自己做一个：
 * Next.js 开发模式左下角那个 "Open Next.js Dev Tools" 写死在 bundle 里，
 * 没有语言配置项，只能留着或者关掉。既然要关，不如换一个对我们有用的：
 * 这个项目接下来每一步都在跟 key、跟模型返回打交道，
 * 有个能一眼看到「key 配没配」的开关，比原版那个有用。
 *
 * 为什么只在开发模式出现：
 * 正式交付时评委不该看到调试工具。process.env.NODE_ENV 在构建时就被替换成
 * 字面量，所以生产包里这段代码整个被摇掉，不是靠 CSS 藏起来。
 *
 * 为什么关掉原版按钮不会连错误浮层一起关掉：
 * 两者是独立的两套东西。实测过：devIndicators: false 之后，
 * 页面里 throw new Error 依然会弹出红色浮层。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** /api/health 的返回结构，跟 app/api/health/route.ts 对应。 */
type Health = {
  keyConfigured: boolean;
  keyLength: number;
  warnings: string[];
  model: string;
};

/** 按钮上那个小圆点的四种状态。 */
type Status = "idle" | "loading" | "ok" | "warn" | "error";

const STATUS_TEXT: Record<Status, string> = {
  idle: "未检测",
  loading: "检测中",
  ok: "正常",
  warn: "有告警",
  error: "连不上",
};

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /** 打一次体检接口，顺手记下花了多少毫秒。 */
  const check = useCallback(async () => {
    setStatus("loading");
    const started = Date.now();

    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as Health;
      setHealth(data);
      setElapsed(Date.now() - started);

      // key 没配也算「有告警」：面板存在的意义就是让人看见这件事。
      const suspicious = data.warnings.length > 0 || !data.keyConfigured;
      setStatus(suspicious ? "warn" : "ok");
    } catch {
      setHealth(null);
      setElapsed(null);
      setStatus("error");
    }
  }, []);

  // 挂载时先探一次，这样按钮上的小圆点在没点开之前就有颜色。
  useEffect(() => {
    void check();
  }, [check]);

  // 每次打开都重新探一次，免得看到的是几分钟前的旧状态。
  useEffect(() => {
    if (!open) return;
    void check();
  }, [open, check]);

  // Esc 关闭 + 点面板外面关闭。
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  // 生产构建里直接不渲染。注意这行必须在所有 hook 之后，
  // 否则开发模式和正式模式的 hook 顺序不一致，React 会报错。
  if (process.env.NODE_ENV === "production") return null;

  const dotClass =
    status === "ok"
      ? "debug-dot debug-dot-ok"
      : status === "warn"
        ? "debug-dot debug-dot-warn"
        : status === "error"
          ? "debug-dot debug-dot-error"
          : "debug-dot";

  const keyText = !health
    ? "—"
    : health.keyConfigured
      ? `已配置 · ${health.keyLength} 位`
      : "未配置";

  const keyClass = !health
    ? "debug-val"
    : health.keyConfigured
      ? "debug-val debug-val-ok"
      : "debug-val debug-val-warn";

  return (
    <div className="debug-root" ref={rootRef}>
      {open && (
        <div
          className="debug-panel"
          id="debug-panel"
          role="dialog"
          aria-label="调试面板"
        >
          <div className="debug-title">
            <span>调试面板</span>
            <span>{STATUS_TEXT[status]}</span>
          </div>

          <div className="debug-row">
            <span className="debug-key">运行模式</span>
            <span className="debug-val">开发模式</span>
          </div>

          <div className="debug-row">
            <span className="debug-key">API Key</span>
            <span className={keyClass}>{keyText}</span>
          </div>

          <div className="debug-row">
            <span className="debug-key">模型</span>
            <span className="debug-val">{health?.model ?? "—"}</span>
          </div>

          <div className="debug-row">
            <span className="debug-key">检测耗时</span>
            <span className="debug-val">
              {elapsed === null ? "—" : `${elapsed} ms`}
            </span>
          </div>

          {status === "error" && (
            <div className="debug-warn">
              <span className="debug-warn-label">接口连不上</span>
              <ul>
                <li>确认 npm run dev 还开着</li>
                <li>确认访问的是 3000 端口</li>
              </ul>
            </div>
          )}

          {health && health.warnings.length > 0 && (
            <div className="debug-warn">
              <span className="debug-warn-label">
                key 有 {health.warnings.length} 处可疑
              </span>
              <ul>
                {health.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="debug-retry"
            onClick={() => void check()}
            disabled={status === "loading"}
          >
            {status === "loading" ? "检测中…" : "重新检测"}
          </button>
        </div>
      )}

      <button
        type="button"
        className="debug-btn"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="debug-panel"
        aria-label={open ? "收起调试面板" : "打开调试面板"}
      >
        <span className={dotClass} aria-hidden="true" />
        调试
      </button>
    </div>
  );
}
