// src/utils/pagination.ts
// AdminVector 与 AdminAccess 曾各自实现过一份 usePaged：一份夹取当前页、一份不夹取。
// 不夹取的那份在「筛选把结果缩小」或「删掉当前页最后一条」后会停在越界页上，
// 表格空白但页脚仍写着「第 5 / 1 页」。这里收敛成一个纯函数，页脚与切片共用同一份数据。

export const PAGE_SIZE = 20;

export interface Page<T> {
  /** 当前页的行 */
  items: T[];
  /** 夹取后的当前页，可直接展示 */
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  /** 当前页首行在全量结果中的下标，用于行号 */
  offset: number;
}

export function paginate<T>(
  rows: T[],
  page: number,
  pageSize = PAGE_SIZE,
): Page<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requested = Math.trunc(page);
  const current = Math.min(
    Math.max(Number.isNaN(requested) || requested === 0 ? 1 : requested, 1),
    pages,
  );
  const offset = (current - 1) * pageSize;
  return {
    items: rows.slice(offset, offset + pageSize),
    page: current,
    pages,
    total,
    pageSize,
    offset,
  };
}
