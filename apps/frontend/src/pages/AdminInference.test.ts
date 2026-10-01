// src/pages/AdminInference.test.ts
// /admin/inference 的算术。隐藏标签页量不到布局（见交接文档 §11.4），
// 但「这个读数是不是在骗人」是可以钉死的：进度、显存占比、在途判据、目录清单的排序
// 都在这几个纯函数里。
import { describe, expect, it } from "vitest";
import type {
  InferenceOverview,
  LaunchProgress,
  LivenessProbe,
  RunningModel,
} from "../api/inference";
import {
  describeChoice,
  filterRegistrations,
  gibText,
  instanceLabel,
  isRunning,
  isTerminalProgress,
  lenRisk,
  modelsForRole,
  movingLaunches,
  openLaunches,
  parseExtra,
  percentOf,
  probeCounts,
  probeToneOf,
  quantOf,
  ratioPercent,
  runningIndex,
  sortRegistrations,
  uidOf,
  uidProblem,
  versionForSpec,
} from "../utils/inferenceFormat";

const model = (m: Partial<RunningModel>): RunningModel => m;

/** 只有这两个字段被读到，其余用 never 占不住 —— 所以按 Pick 的形状造。 */
const reading = (
  models: RunningModel[],
  launchErrors: InferenceOverview["launch_errors"] = {},
): Pick<InferenceOverview, "models" | "launch_errors"> => ({
  models,
  launch_errors: launchErrors,
});

describe("uidOf", () => {
  it("两个字段都认，且优先 model_uid", () => {
    // 服务器把 uid 放在 `id`（restful_api.py:1387），别处见过 `model_uid`：
    // 判据若只认一边，运行中的模型会被当成「没起来」。
    expect(uidOf(model({ id: "bge-m3" }))).toBe("bge-m3");
    expect(uidOf(model({ model_uid: "bge-m3" }))).toBe("bge-m3");
    expect(uidOf(model({ id: "rep0", model_uid: "real" }))).toBe("real");
    expect(uidOf(model({}))).toBe("");
  });
});

describe("openLaunches / movingLaunches", () => {
  const launched = ["gemma-4", "bge-m3"];
  const errors: InferenceOverview["launch_errors"] = {
    "bge-m3": { error: "服务器已受理，但 60 秒内没有任何动作", at: 1 },
  };

  it("没提交过 → 稳定返回同一个空引用", () => {
    const out = openLaunches([], reading([]));
    expect(out).toEqual([]);
    // 引用稳定才有意义：调用方把它放进 useMemo 依赖，每次新数组等于没有 memo。
    expect(openLaunches([], reading([model({ id: "x" })]))).toBe(out);
  });

  it("还没有任何读数 → 全部算未落定（宁可多显示一行、多轮一次）", () => {
    expect(openLaunches(launched, null)).toEqual(launched);
    expect(movingLaunches(launched, undefined)).toEqual(launched);
  });

  it("进了运行清单就摘掉，没进的留下", () => {
    expect(openLaunches(launched, reading([model({ id: "gemma-4" })]))).toEqual(["bge-m3"]);
  });

  it("失败的**留在显示列表里**，但不再占轮询 —— 那一行是唯一说得出原因的地方", () => {
    // 这条是本轮修的东西：失败如果被一起滤掉，行会无声消失，用户又回到「点了没反应」。
    expect(openLaunches(launched, reading([], errors))).toEqual(["gemma-4", "bge-m3"]);
    expect(movingLaunches(launched, reading([], errors))).toEqual(["gemma-4"]);
  });

  it("成功 + 失败同时落定 → 都不再轮，但失败那条还看得见", () => {
    const data = reading([model({ id: "gemma-4" })], errors);
    expect(movingLaunches(launched, data)).toEqual([]);
    expect(openLaunches(launched, data)).toEqual(["bge-m3"]);
  });

  it("卸载后不算未落定（所以卸载成功要把这次尝试忘掉）", () => {
    expect(openLaunches(["bge-m3"], reading([model({ id: "bge-m3" })]))).toEqual([]);
    // 若页面不清掉 launched，这条会在模型被卸载后重新变回「未落定」并重新拉起轮询。
    expect(openLaunches(["bge-m3"], reading([]))).toEqual(["bge-m3"]);
  });
});

describe("isRunning", () => {
  it("按 uid 认，不按 model_name 认", () => {
    const rows = [model({ id: "bge-m3-rep0", model_name: "bge-m3" })];
    expect(isRunning(rows, "bge-m3-rep0")).toBe(true);
    // model_name 相同不代表同一个实例：绑定与卸载都以 uid 为准（实测 400 就是这么来的）
    expect(isRunning(rows, "bge-m3")).toBe(false);
  });
});

describe("isTerminalProgress", () => {
  it.each<[string, LaunchProgress | null | undefined, boolean]>([
    ["没有数据", null, false],
    ["已知终态 running", { stage: "running" }, true],
    ["已知终态 failed", { stage: "failed" }, true],
    ["stage 大小写不一致", { stage: "READY" }, true],
    ["未知 stage 一律继续轮", { stage: "downloading_weights" }, false],
    ["父进度到 1 但副本还在起 → 不算终态", { progress: 1, stage: "loading", replicas: [{ progress: 0.4 }] }, false],
    ["父进度到 1 且副本都到位", { progress: 1, stage: "loading", replicas: [{ progress: 1 }] }, true],
    ["父进度到 1 且无副本", { progress: 1, stage: "loading" }, true],
  ])("%s", (_name, p, want) => {
    expect(isTerminalProgress(p)).toBe(want);
  });
});

describe("percentOf", () => {
  it("拿不到数就是 null，不画 0%", () => {
    expect(percentOf(null)).toBeNull();
    expect(percentOf({})).toBeNull();
    expect(percentOf({ progress: undefined, replicas: [] })).toBeNull();
  });

  it("0 是真实读数，和「未知」不是一回事", () => {
    expect(percentOf({ progress: 0 })).toBe(0);
  });

  it("多副本取最慢的那个（进度条不能只报好消息）", () => {
    expect(percentOf({ progress: 1, replicas: [{ progress: 0.3 }, { progress: 0.8 }] })).toBe(30);
  });

  it("越界的数被夹回 0–100", () => {
    expect(percentOf({ progress: 1.7 })).toBe(100);
    expect(percentOf({ progress: -0.5 })).toBe(0);
  });
});

describe("ratioPercent", () => {
  it("分母缺失或为 0 → null，界面画「—」而不是 0%", () => {
    expect(ratioPercent(1024, 0)).toBeNull();
    expect(ratioPercent(1024, null)).toBeNull();
    expect(ratioPercent(undefined, undefined)).toBeNull();
  });

  it("正常占比并且不超过 100", () => {
    expect(ratioPercent(512, 1024)).toBe(50);
    expect(ratioPercent(2048, 1024)).toBe(100);
  });
});

describe("gibText", () => {
  it("缺失就是「—」", () => {
    expect(gibText(null)).toBe("—");
    expect(gibText(undefined)).toBe("—");
  });

  it("小于 0.1 GiB 退到 MiB —— 写成 0.00 GiB 会让人以为没占显存", () => {
    expect(gibText(64 * 1024 ** 2)).toBe("64 MiB");
    expect(gibText(1024 ** 3)).toBe("1.0 GiB");
    expect(gibText(22 * 1024 ** 3)).toBe("22 GiB");
  });
});

describe("modelsForRole", () => {
  const rows = [
    model({ id: "gemma-4", model_type: "LLM" }),
    model({ id: "bge-m3", model_type: "embedding" }),
    model({ id: "old", model_type: "image" }),
  ];

  it("按服务器报的类型筛，大小写照服务器原样（LLM 是大写）", () => {
    expect(modelsForRole(rows, "llm").map(uidOf)).toEqual(["gemma-4"]);
    expect(modelsForRole(rows, "embedding").map(uidOf)).toEqual(["bge-m3"]);
    expect(modelsForRole(rows, "rerank")).toEqual([]);
  });

  it("没报类型的条目不会混进候选", () => {
    expect(modelsForRole([model({ id: "mystery" })], "llm")).toEqual([]);
  });
});

describe("instanceLabel", () => {
  it("同一型号开两个实例时，确认框必须说清停的是哪一个", () => {
    // 实测：model_uid=bge-m3-copy 的条目，model_name 仍然是 bge-m3。
    // 只报名字的话，破坏性动作的确认框会指着「被绑定的那一个」的名字。
    expect(
      instanceLabel(model({ id: "bge-m3-copy", model_name: "bge-m3" })),
    ).toBe("bge-m3 · bge-m3-copy");
  });

  it("名字就是 uid 时不重复一遍", () => {
    expect(instanceLabel(model({ id: "bge-m3", model_name: "bge-m3" }))).toBe("bge-m3");
    expect(instanceLabel(model({ id: "only-uid" }))).toBe("only-uid");
    expect(instanceLabel(model({ model_name: "named" }))).toBe("named");
    expect(instanceLabel(model({}))).toBe("");
  });
});

describe("filterRegistrations / sortRegistrations", () => {
  const rows = [
    { model_name: "bge-large-zh" },
    { model_name: "bge-m3" },
    { model_name: "APIE-M3" },
    { model_name: "maidalir1.5" },
  ];

  it("筛选是不区分大小写的包含匹配，空条件原样返回同一个引用", () => {
    expect(filterRegistrations(rows, "  ").length).toBe(4);
    // 空条件返回同一个数组而不是副本：调用方把它放进 useMemo 依赖时不会白白变
    expect(filterRegistrations(rows, "")).toBe(rows);
    expect(filterRegistrations(rows, "apie")).toEqual([{ model_name: "APIE-M3" }]);
    expect(filterRegistrations(rows, "bge-").map((r) => r.model_name)).toEqual([
      "bge-large-zh",
      "bge-m3",
    ]);
  });

  it("已在盘上的排在前面，其余按名字排；不改原数组", () => {
    const cached = new Set(["bge-m3"]);
    const sorted = sortRegistrations(rows, cached);
    expect(sorted.map((r) => r.model_name)).toEqual([
      "bge-m3",
      "APIE-M3",
      "bge-large-zh",
      "maidalir1.5",
    ]);
    // 排序不能就地改：那个数组来自 react-query 缓存，改了下一帧读到的就是被重排过的缓存
    expect(rows.map((r) => r.model_name)).toEqual([
      "bge-large-zh",
      "bge-m3",
      "APIE-M3",
      "maidalir1.5",
    ]);
  });

  it("一个都没缓存时就是纯字母序（不会把清单弄乱）", () => {
    expect(sortRegistrations(rows, new Set()).map((r) => r.model_name)).toEqual(
      [...rows.map((r) => r.model_name)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("uidProblem", () => {
  it("留空合法（等于用型号名），过长与保留后缀都挡下", () => {
    expect(uidProblem("")).toBeNull();
    expect(uidProblem("   ")).toBeNull();
    expect(uidProblem("bge-m3-copy")).toBeNull();
    expect(uidProblem("x".repeat(101))).toBe("tooLong");
    // 副本 uid 是服务器自己拼的，占用它会让「查这个 uid 的实例」撞到不该撞的东西上
    expect(uidProblem("bge-m3-rep0")).toBe("reservedSuffix");
    expect(uidProblem("bge-m3-rep12")).toBe("reservedSuffix");
    // 只有 `-rep<数字>` 结尾才算，普通名字里带 rep 不该误伤
    expect(uidProblem("repair-bot")).toBeNull();
  });
});

describe("lenRisk", () => {
  it("填得比应用运行时的预算小 → 可预见的坏（只有我们知道 .env 那个值）", () => {
    expect(lenRisk(30000, 4096)).toBe("tooSmall");
    expect(lenRisk(30000, 30000)).toBeNull();
    expect(lenRisk(30000, 40000)).toBeNull();
  });

  it("超过服务器声明的上限优先报超上限", () => {
    expect(lenRisk(30000, 400000, 262144)).toBe("overCap");
    expect(lenRisk(30000, 100000, 262144)).toBeNull();
  });

  it("拿不到的数不编风险出来", () => {
    expect(lenRisk(undefined, 4096)).toBeNull();
    expect(lenRisk(30000, undefined)).toBeNull();
    expect(lenRisk(30000, 0)).toBeNull();
    expect(lenRisk(30000, Number.NaN)).toBeNull();
    expect(lenRisk(0, 4096, 0)).toBeNull();
  });
});

describe("parseExtra", () => {
  it("空文本 = 不带任何额外参数", () => {
    expect(parseExtra("")).toEqual({ ok: true });
    expect(parseExtra("   ")).toEqual({ ok: true });
  });

  it("对象透传，数组/标量/坏 JSON 都挡住并给出可分开的码", () => {
    expect(parseExtra('{"max_num_seqs": 32}')).toEqual({
      ok: true,
      value: { max_num_seqs: 32 },
    });
    expect(parseExtra("{")).toEqual({ ok: false, code: "invalidJson" });
    expect(parseExtra("[1,2]")).toEqual({ ok: false, code: "notObject" });
    expect(parseExtra("null")).toEqual({ ok: false, code: "notObject" });
    expect(parseExtra("42")).toEqual({ ok: false, code: "notObject" });
  });
});

describe("versionForSpec", () => {
  // 真实目录里 bge-m3 的两种规格：pytorch（权重已在盘上）与 ggufv2 Q4_K_M（要下载）
  const versions = [
    { model_version: "bge-m3--8192--1024--pytorch--none", dimensions: 1024, cache_status: true },
    { model_version: "bge-m3--8192--1024--ggufv2--F16", dimensions: 1024, cache_status: false },
    { model_version: "bge-m3--8192--1024--ggufv2--Q4_K_M", dimensions: 1024, cache_status: false },
    { model_version: "bge-small--512--384--pytorch--none", dimensions: 384, cache_status: true },
  ];

  it("按「格式 + 量化」对上那条版本，而不是恒取第一条", () => {
    const picked = versionForSpec(versions, {
      model_format: "ggufv2",
      quantizations: ["F16", "Q4_K_M"],
    });
    expect(picked?.model_version).toBe("bge-m3--8192--1024--ggufv2--F16");
    expect(versionForSpec(versions, { model_format: "ggufv2", quantization: "Q4_K_M" })
      ?.model_version).toBe("bge-m3--8192--1024--ggufv2--Q4_K_M");
  });

  it("维度和缓存状态必须跟着选中的规格走（取错条就是把别人的数字显示上来）", () => {
    const small = versionForSpec(versions, { model_format: "pytorch", quantization: "none" });
    expect(small?.dimensions).toBe(1024);
    // 规格名不同型号时不该串台：这条只能靠「格式+量化」匹配到 pytorch 那一族
    expect(small?.model_version).toContain("bge-m3");
  });

  it("同格式下没有这个量化时，仍留在同格式内（维度对同一格式是同一个值）", () => {
    const picked = versionForSpec(versions, { model_format: "ggufv2", quantization: "Q8_0" });
    expect(picked?.model_version).toContain("ggufv2");
  });

  it("对不上就不编：多条版本而没有规格时，宁可不显示这条事实", () => {
    expect(versionForSpec([], { model_format: "pytorch" })).toBeUndefined();
    // 旧实现在这里退回 versions[0] —— 于是用户选中的 gguf 规格会显示 pytorch 那条的
    // 维度与「权重已在盘上」，而函数自己的注释写的正是禁止这件事。
    // 少显示一行不会害任何人，显示错的那一行会让人按错的数字换 embedding 模型。
    expect(versionForSpec(versions)).toBeUndefined();
    expect(versionForSpec(versions, {})).toBeUndefined();
    // 只有一条版本时没有歧义可言：它就是要加载的那条，不存在「配错」
    expect(
      versionForSpec([{ model_version: "only--512--64--ggufv2--Q4", dimensions: 64 }])
        ?.model_version,
    ).toBe("only--512--64--ggufv2--Q4");
  });
});

describe("runningIndex —— 实例 uid 与型号名是两件事，混一次就多开一份副本", () => {
  it("自定义过实例名时，两个集合各自说真话", () => {
    const idx = runningIndex([model({ model_uid: "prod-bge", model_name: "bge-m3" })]);
    expect(idx.uids.has("prod-bge")).toBe(true);
    // 这条就是那个 bug 的形状：拿 uid 集合去比型号名会判成「没在跑」，
    // 于是清单不显示运行中、按钮也不换成「去绑定」，点一下 = 再启动一份、白占一遍显存。
    expect(idx.uids.has("bge-m3")).toBe(false);
    expect(idx.names.has("bge-m3")).toBe(true);
    expect(idx.names.has("prod-bge")).toBe(false);
  });

  it("同一型号的多个实例：名字只算一次，uid 各算各的", () => {
    const idx = runningIndex([
      model({ model_uid: "bge-m3", model_name: "bge-m3" }),
      model({ model_uid: "bge-m3-copy", model_name: "bge-m3" }),
    ]);
    expect([...idx.uids].sort()).toEqual(["bge-m3", "bge-m3-copy"]);
    expect([...idx.names]).toEqual(["bge-m3"]);
  });

  it("没有 uid 的条目不拿型号名顶上：宁可少一个判据", () => {
    const idx = runningIndex([model({ model_name: "solo" })]);
    expect(idx.uids.size).toBe(0);
    expect(idx.names.has("solo")).toBe(true);
  });
});

describe("describeChoice", () => {
  it("量化为 none 时不写出来（写了像是「有个叫 none 的量化」）", () => {
    expect(
      describeChoice({
        model_name: "b",
        model_type: "embedding",
        engine: "vLLM",
        size_in_billions: 4,
        model_format: "pytorch",
        quantization: "none",
      }),
    ).toBe("vLLM · 4B · pytorch");
  });

  it("缺字段就少写一段，不留下多余的点", () => {
    expect(describeChoice({ model_name: "b", model_type: "LLM", engine: "Transformers" })).toBe(
      "Transformers",
    );
    expect(
      describeChoice({ model_name: "b", model_type: "LLM", engine: "vLLM", quantization: "q4" }),
    ).toBe("vLLM · q4");
  });
});

describe("quantOf —— 界面显示的量化必须就是发出去的那个", () => {
  it("有 quantization 用它", () => {
    expect(quantOf({ quantization: "q4_0", quantizations: ["q4_0", "q8_0"] })).toBe("q4_0");
  });

  it("只给列表时取第一个（和 xinference 自己表单的默认一致）", () => {
    expect(quantOf({ quantizations: ["fp16", "q4"] })).toBe("fp16");
  });

  it("空串不是量化方式，要当成没给", () => {
    // 服务器对「没有量化」有时写 ""，有时写 "none"。用 `??` 的话空串会被当成有值，
    // 于是发给引擎一个没人认识的量化方式 —— 症状是加载失败，而界面上看不出为什么。
    expect(quantOf({ quantization: "", quantizations: ["gguf-q4"] })).toBe("gguf-q4");
    expect(quantOf({ quantization: "" })).toBeUndefined();
  });

  it("两个都没有就是没有，不编一个出来", () => {
    expect(quantOf({})).toBeUndefined();
    expect(quantOf(undefined)).toBeUndefined();
    expect(quantOf(null)).toBeUndefined();
  });

  it('"none" 要照原样留着：藏起来只属于展示层', () => {
    // describeChoice 会滤掉 "none"（人读起来那是一行噪声），但发给引擎的必须是它，
    // 所以过滤不能发生在这个函数里 —— 这条断言就是防止有人顺手把它「修好」。
    expect(quantOf({ quantization: "none" })).toBe("none");
    expect(
      describeChoice({
        model_name: "b",
        model_type: "embedding",
        size_in_billions: 1,
        model_format: "pytorch",
        quantization: quantOf({ quantization: "none" }),
      }),
    ).toBe("1B · pytorch");
  });
});

const probe = (p: Partial<LivenessProbe>): LivenessProbe => ({
  role: "llm",
  model_uid: "gemma-4",
  ok: true,
  latency_ms: 1200,
  detail: "回了 2 字",
  ...p,
});

describe("probeCounts / probeToneOf", () => {
  it("undefined（还没探过）算 0 条而不是崩", () => {
    expect(probeCounts(undefined as LivenessProbe[] | undefined)).toEqual({
      total: 0,
      ok: 0,
      bad: 0,
    });
  });

  it("全通时 bad=0", () => {
    const c = probeCounts([probe({}), probe({ role: "embedding" }), probe({ role: "rerank" })]);
    expect(c).toEqual({ total: 3, ok: 3, bad: 0 });
  });

  it("HTTP 200 但正文为空要记成不可用（那次 CUDA sticky 事故的形状）", () => {
    const empty = probe({ ok: false, detail: "HTTP 200 但正文为空" });
    const c = probeCounts([empty, probe({ role: "embedding" })]);
    expect(c.bad).toBe(1);
    expect(probeToneOf(empty)).toBe("danger");
  });

  it("没探测与探测失败不共用一种颜色", () => {
    expect(probeToneOf(undefined)).toBe("neutral");
    expect(probeToneOf(probe({ ok: true }))).toBe("success");
    expect(probeToneOf(probe({ ok: false }))).toBe("danger");
  });
});
