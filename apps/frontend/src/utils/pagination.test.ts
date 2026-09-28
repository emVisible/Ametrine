// src/utils/pagination.test.ts
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, paginate } from "./pagination";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("按页取切片并给出总页数", () => {
    const paged = paginate(rows(45), 2);
    expect(paged.items).toEqual(rows(45).slice(20, 40));
    expect(paged).toMatchObject({ page: 2, pages: 3, total: 45, offset: 20 });
  });

  it("恰好整除时不会多出一个空页", () => {
    const paged = paginate(rows(40), 2);
    expect(paged.pages).toBe(2);
    expect(paged.items).toHaveLength(PAGE_SIZE);
  });

  // 这一条是修复本体：越界页以前会切出空数组，页脚却仍显示旧页码
  it("当前页越界时夹取到最后一页而不是返回空表", () => {
    const paged = paginate(rows(45), 9);
    expect(paged.page).toBe(3);
    expect(paged.items).toEqual([41, 42, 43, 44, 45]);
    expect(paged.offset).toBe(40);
  });

  it("页码非法时回到第一页", () => {
    for (const bad of [0, -3, Number.NaN]) {
      expect(paginate(rows(45), bad).page).toBe(1);
    }
  });

  it("空结果集仍然是一个合法的第一页", () => {
    const paged = paginate([] as number[], 4);
    expect(paged).toMatchObject({ items: [], page: 1, pages: 1, total: 0 });
  });

  it("自定义 pageSize 时页脚与切片保持一致", () => {
    const paged = paginate(rows(25), 2, 10);
    expect(paged).toMatchObject({ page: 2, pages: 3, offset: 10, pageSize: 10 });
    expect(paged.items).toEqual(rows(25).slice(10, 20));
  });

  it("最后一项的序号等于 offset + 行内下标 + 1", () => {
    const paged = paginate(rows(41), 3);
    const last = paged.offset + paged.items.length;
    expect(last).toBe(41);
  });
});
