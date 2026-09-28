// src/hooks/useRovingTabs.ts
import type { KeyboardEvent, RefObject } from "react";

/**
 * tablist 的键盘约定：箭头/Home/End 在页签之间移动焦点并选中（自动激活）。
 *
 * 之所以自动激活：这里的页签切换的都是纯客户端视图，没有「切错要付代价」的问题；
 * 手动激活（箭头只移焦点、必须回车才切）会让人多点一次键，还容易和读屏的预期不一致。
 *
 * 配套的 roving tabindex 由调用方负责：只有当前项 tabIndex=0，其余 -1，
 * 否则 Tab 键会把每个页签都走一遍，破坏「一组控件占一个停靠点」的约定。
 */
export function useRovingTabs(
  ref: RefObject<HTMLElement | null>,
  { index, onSelect }: { index: number; onSelect: (next: number) => void },
) {
  return (e: KeyboardEvent) => {
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!items?.length) return;
    const last = items.length - 1;
    let next: number;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index >= last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index <= 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }

    e.preventDefault();
    items[next]?.focus();
    onSelect(next);
  };
}
