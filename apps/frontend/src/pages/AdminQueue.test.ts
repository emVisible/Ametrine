import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { describeRetrieval } from "../utils/retrievalCopy";

// 取两种语言里真实存在的 t()：键漏翻会在 tsc 阶段就报错（en: typeof zh），
// 这里只钉「同一条事实在两种语言下都被分到正确的桶里」。
const t = (key: string, params?: Record<string, string | number>) => {
  const path = key.split(".");
  let node: unknown = zh as Record<string, unknown>;
  for (const seg of path) node = (node as Record<string, unknown>)[seg];
  const template = String(node);
  return template.replace(/\{(\w+)\}/g, (_m, name) => String(params?.[name] ?? ""));
};

const base = {
  sources: [{ database: "middle", collection: "core" }],
  source_count: 1,
  top_k: 5,
  candidates: 8,
  returned: 3,
  elapsed_ms: 120,
  outcome: "ok",
  reranked: true,
  score_max: 0.87,
};

describe("describeRetrieval", () => {
  it("把「库里没内容」和「有内容但被筛光」分开说", () => {
    expect(describeRetrieval({ ...base, outcome: "no_hits", candidates: 0, returned: 0 }, t)).toBe(
      zh.queue.retrieval.noHits,
    );
    expect(describeRetrieval({ ...base, outcome: "filtered_out", returned: 0 }, t)).toContain("8");
  });

  it("重排过的显示最高分，没重排的不编分数", () => {
    expect(describeRetrieval(base as never, t)).toContain("0.87");
    const { score_max, reranked, ...noScore } = base;
    expect(describeRetrieval(noScore as never, t)).not.toContain("0.87");
  });

  it("耗时总是带出来（它是「慢在哪」的唯一线索）", () => {
    expect(describeRetrieval(base as never, t)).toContain("120ms");
  });

  it("中英两份字典都有这四条键", () => {
    expect(Object.keys(en.queue.retrieval).sort()).toEqual(
      Object.keys(zh.queue.retrieval).sort(),
    );
  });
});
