/**
 * `Disclosure` 的 children 里不许放弹层。
 *
 * 起因是一个实测到的缺陷（交接文档 §3.10 缺陷 3）：`/admin/vector` 折叠行上的
 * 「新建集合」按钮 enabled、能点、点了什么都不发生 —— 因为按钮在常驻的 `actions` 槽，
 * 而它要打开的 `<Modal>` 写在 `children` 里，`children` 在折叠时整体不渲染。
 *
 * 只挪那一处等于只修一个实例，所以这里把约束钉成测试。
 * 第三条用例尤其重要：**用一个故意写错的样本证明这条审计真的会红** ——
 * 否则「扫描结果为空」既可能是干净，也可能是正则失效，两者在绿灯上长得一模一样
 * （`keys.test.ts` 里那种静默空跑，这一晚已经实际踩过一次）。
 */

import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SKIP = /components[/\\]ui\.tsx$|components[/\\]disclosure\.test\.ts$/;

/**
 * 从 `<Disclosure` 起，找到它**开标签**的结束位置。
 *
 * 不能简单找第一个 `>` 或 `/>`：属性里的 JSX 表达式（`actions={<button />}`、
 * `onToggle={() => {}}`）本身就带 `>` 和 `/>`。第一版就用 `/>` 判自闭合，
 * 结果任何带按钮的 `<Disclosure>` 都被当成自闭合跳过 —— 检测器看起来在工作，实际永远不会报。
 * 所以按 `{}` 深度与引号走一遍，只在深度 0 处认 `>`。
 */
function openTagEnd(text: string, from: number): { end: number; selfClosing: boolean } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (ch === ">" && depth === 0)
      return { end: i + 1, selfClosing: text[i - 1] === "/" };
  }
  return null;
}

/** 返回 `<Disclosure …> … </Disclosure>` 的 **children 区**里出现的弹层标签。 */
function findModalsInsideDisclosure(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/<Disclosure\b/g)) {
    const start = m.index ?? 0;
    const tag = openTagEnd(text, start);
    if (!tag || tag.selfClosing) continue; // 自闭合不承载 children，天然没有这个问题
    const closeIdx = text.slice(tag.end).search(/<\/Disclosure>/);
    if (closeIdx === -1) continue;
    const inner = text.slice(tag.end, tag.end + closeIdx);
    for (const modal of inner.matchAll(/<(Modal|ConfirmDialog)\b/g)) {
      found.push(modal[1] ?? "Modal");
    }
  }
  return found;
}

const violations: string[] = [];
let disclosureSites = 0;

for (const [file, text] of Object.entries(sources)) {
  if (SKIP.test(file)) continue;
  const hits = findModalsInsideDisclosure(text);
  disclosureSites += (text.match(/<Disclosure\b/g) ?? []).length;
  if (hits.length) violations.push(`${file} 里 ${hits.length} 个 <Modal>…</Modal> 写在 Disclosure 的 children 里（应改用 overlay 槽）`);
}

describe("Disclosure 与弹层的位置约束", () => {
  it("确实扫到了使用 Disclosure 的源码（否则这条审计是空跑）", () => {
    expect(disclosureSites).toBeGreaterThan(0);
  });

  it("没有任何弹层被写在折叠时不渲染的 children 里", () => {
    expect(violations).toEqual([]);
  });

  it("自检：违规写法真的会被抓出来", () => {
    const bad = `
      <Disclosure open={false} onToggle={() => {}} actions={<button />} >
        <ul><li>集合</li></ul>
        <Modal open={creating} title="新建集合"><input /></Modal>
      </Disclosure>
    `;
    const good = `
      <Disclosure open={false} onToggle={() => {}} overlay={<Modal open title="x" />} actions={<button />}>
        <ul><li>集合</li></ul>
      </Disclosure>
    `;
    expect(findModalsInsideDisclosure(bad)).toEqual(["Modal"]);
    expect(findModalsInsideDisclosure(good)).toEqual([]);
  });
});
