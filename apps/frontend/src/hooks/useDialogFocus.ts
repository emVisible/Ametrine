// src/hooks/useDialogFocus.ts
import { useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusableInside(node: HTMLElement) {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

/**
 * 弹层的焦点协议，一个 effect 里按固定顺序做完四件事：
 * 捕获 opener → 锁背景(inert) → 圈定 Tab → 关闭时先解锁再归还焦点。
 *
 * 顺序必须写在一个 effect 体内，不能拆成两个 hook：
 * 拆开后清理顺序由声明顺序决定，很容易变成「还在 inert 状态下 focus()」，浏览器直接忽略。
 * 弹层本身要 portal 到 body（挂在 #app-shell 里会被自己锁掉）。
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  shellId = "app-shell",
) {
  // 每个弹层实例只认第一次捕获的 opener。
  // 不在清理里清空：StrictMode 会把挂载 effect 跑两遍，第一遍的清理刚把焦点还给触发按钮，
  // React 随即又把焦点恢复到 body，第二遍 setup 若重新捕获就会抓到 <body>，归还永远无效。
  const openerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (!openerRef.current) {
      openerRef.current = document.activeElement as HTMLElement | null;
    }
    const opener = openerRef.current;
    const shell = document.getElementById(shellId);
    shell?.setAttribute("inert", "");
    shell?.setAttribute("aria-hidden", "true");

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableInside(node);
      const first = items.at(0);
      const last = items.at(-1);
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const current = document.activeElement;
      const inside = current instanceof HTMLElement && node.contains(current);
      if (e.shiftKey && (!inside || current === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || current === last)) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      shell?.removeAttribute("inert");
      shell?.removeAttribute("aria-hidden");
      if (!opener?.isConnected) return;

      const restore = () => {
        if (!opener.isConnected) return;
        const active = document.activeElement;
        // 已经有明确落点（比如紧接着又开了另一个弹层）就不抢焦点
        if (active && active !== document.body && active !== document.documentElement) return;
        opener.focus();
      };
      // 同步一次；React 19 会在删除提交后把焦点恢复到 body，所以再排一个宏任务补刀。
      // 不用 requestAnimationFrame：标签页不可见时 rAF 不执行，归还就会永久失效。
      restore();
      window.setTimeout(restore, 0);
    };
  }, [ref, shellId]);
}
