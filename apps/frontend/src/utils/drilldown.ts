// src/utils/drilldown.ts
import type { KbCollection, KbDatabase } from "../types/knowledge";

/**
 * 知识库控制台三级下钻的解析结果。
 * 单独抽出来是因为「链接指向一个已删除的库/集合」必须有明确说法，
 * 而不是悄悄退回上一级——那样地址栏和内容就各说各话了。
 */
export type Drilldown =
  | { level: "databases" }
  | { level: "collections"; database: KbDatabase }
  | { level: "documents"; database: KbDatabase; collection: KbCollection }
  | { level: "database-missing"; dbId: string }
  | { level: "collection-missing"; database: KbDatabase; colId: string };

function asId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function resolveDrilldown(
  databases: KbDatabase[],
  collectionsByDb: Map<number, KbCollection[]>,
  dbId?: string,
  colId?: string,
): Drilldown {
  if (!dbId) return { level: "databases" };

  const dbKey = asId(dbId);
  const database =
    dbKey === null ? undefined : databases.find((d) => d.id === dbKey);
  if (!database) return { level: "database-missing", dbId };

  if (!colId) return { level: "collections", database };

  const colKey = asId(colId);
  const collection =
    colKey === null
      ? undefined
      : (collectionsByDb.get(database.id) ?? []).find((c) => c.id === colKey);
  if (!collection) return { level: "collection-missing", database, colId };

  return { level: "documents", database, collection };
}
