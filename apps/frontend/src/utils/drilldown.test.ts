// src/utils/drilldown.test.ts
import { describe, expect, it } from "vitest";
import type { KbCollection, KbDatabase } from "../types/knowledge";
import { resolveDrilldown } from "./drilldown";

const db = (id: number, name = `db${id}`): KbDatabase =>
  ({ id, name, description: null, is_active: true }) as KbDatabase;

const col = (id: number, name = `col${id}`): KbCollection =>
  ({ id, name, description: null }) as KbCollection;

const databases = [db(6), db(7)];
const collectionsByDb = new Map<number, KbCollection[]>([
  [6, [col(12), col(13)]],
  [7, []],
]);

describe("resolveDrilldown", () => {
  it("没有 dbId 时是知识库列表", () => {
    expect(resolveDrilldown(databases, collectionsByDb).level).toBe("databases");
  });

  it("只有 dbId 时是该库的集合列表", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "6");
    expect(view.level).toBe("collections");
  });

  it("dbId 与 colId 都在时是文档列表", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "6", "13");
    expect(view.level).toBe("documents");
  });

  // 这四处是修复本体：以前都会静默退回上一级，地址栏和内容各说各话
  it("dbId 指向已删除的知识库时明确报缺失", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "999");
    expect(view.level).toBe("database-missing");
  });

  it("dbId 不是数字时同样报缺失，而不是退回列表", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "abc");
    expect(view.level).toBe("database-missing");
  });

  it("colId 指向别的库的集合时报集合缺失", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "7", "12");
    expect(view.level).toBe("collection-missing");
  });

  it("空集合的库直接深链到该库的文档页时报集合缺失", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "6", "9999");
    expect(view.level).toBe("collection-missing");
  });

  it("集合缺失的结果里带上所属库，供返回链接使用", () => {
    const view = resolveDrilldown(databases, collectionsByDb, "7", "1");
    if (view.level !== "collection-missing") throw new Error("level 不对");
    expect(view.database.id).toBe(7);
    expect(view.colId).toBe("1");
  });
});
