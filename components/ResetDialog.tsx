"use client";

import { useEffect, useRef } from "react";

/**
 * 「清空这份报告」的确认弹层。
 *
 * 为什么不用 window.confirm：
 * 1. 它的按钮文字由浏览器决定（「确定 / 取消」），没法写成
 *    「清空重来 / 再想想」—— 而这两个词才是用户真正在选的东西。
 *    「确定」确认的是什么？用户得回头再读一遍那句话才知道。
 * 2. 它不可样式化，深色模式下会在深色页面上闪一块纯白，很刺眼。
 * 3. 它阻塞主线程，背后的页面动画会整个卡住。
 *
 * 为什么默认焦点落在「再想想」而不是「清空重来」：
 * 弹层打开后用户最可能的动作是按回车（手还停在键盘上）。
 * 默认落在危险的那一边，等于把「手滑」直接翻译成「数据没了」。
 */

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ResetDialog({ open, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    /*
      点遮罩取消。
      用 onMouseDown 而不是 onClick：在卡片里按下、拖到遮罩上松开，
      click 事件会算在遮罩头上，用户明明只是想选中一段文字，弹层却关了。
    */
    <div className="dialog-mask" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
        aria-describedby="reset-dialog-body"
        /* 卡片内部的 mousedown 不许冒泡到遮罩，否则点卡片空白处也会关 */
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title" id="reset-dialog-title">
          清空这份报告？
        </h2>
        <p className="dialog-body" id="reset-dialog-body">
          提纲、你粘的文献、这次的分析结果都会清掉，回到最开始。
          这一步不能撤销。
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="dialog-btn"
            onClick={onCancel}
            ref={cancelRef}
          >
            再想想
          </button>
          <button
            type="button"
            className="dialog-btn is-danger"
            onClick={onConfirm}
          >
            清空重来
          </button>
        </div>
      </div>
    </div>
  );
}
