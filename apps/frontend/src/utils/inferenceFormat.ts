// src/utils/inferenceFormat.ts
// 推理页的纯函数。单独成文件有两个理由：
//  1) react-refresh 要求页面文件只导出组件（`utils/roles.ts` 同一道理）；
//  2) 这些判断（显存百分比、进度是否终态、uid 到底在哪个字段）是**唯一能被单测钉住**的部分
//     —— 隐藏标签页里量不到布局，但量得到算术。
import type {
  CatalogVersion,
  EngineSpec,
  InferenceOverview,
  InferenceRole,
  LaunchProgress,
  LivenessProbe,
  RegisteredModel,
  RunningModel,
} from "../api/inference";

/** 服务器把 uid 放在 `id`（`restful_api.py:1387`），别处又见过 `model_uid` —— 两个都认。 */
export function uidOf(m: RunningModel | { id?: string; model_uid?: string }): string {
  return m.model_uid || m.id || "";
}

export function gibText(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const gib = bytes / 1024 ** 3;
  // 小于 0.1 GiB 时写成 0.00 GiB 会让人以为「没占显存」，所以退到 MiB
  if (gib > 0 && gib < 0.1) return `${Math.round(bytes / 1024 ** 2)} MiB`;
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
}

/** 0–1 的占比。分母缺失或为 0 时返回 null —— 界面画 0% 会是假话。 */
export function ratioPercent(
  used?: number | null,
  total?: number | null,
): number | null {
  if (used == null || total == null || total <= 0) return null;
  const pct = (used / total) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, pct));
}

export const ROLE_MODEL_TYPE: Record<InferenceRole, string> = {
  llm: "LLM",
  embedding: "embedding",
  rerank: "rerank",
};

/** 某个角色的候选模型：按服务器报的 model_type 筛，不靠 uid 猜。 */
export function modelsForRole(
  models: RunningModel[],
  role: InferenceRole,
): RunningModel[] {
  const want = ROLE_MODEL_TYPE[role];
  return models.filter((m) => (m.model_type || "") === want);
}

/**
 * 进度是否已经到终态（可以停止轮询）。
 *
 * 判据刻意保守：`stage` 的取值在 3.5.0 上实测见过 `pending` / `loading`，
 * 完成时 `progress` 到 1.0。未知 stage 一律**继续轮**——早停一次，
 * 界面就会永远停在一个假的「还在加载」上，比多轮两次贵得多。
 */
export function isTerminalProgress(p?: LaunchProgress | null): boolean {
  if (!p) return false;
  const stage = (p.stage || "").toLowerCase();
  if (["running", "ready", "terminated", "failed", "error"].includes(stage)) return true;
  const reps = p.replicas || [];
  if (typeof p.progress === "number" && p.progress >= 1) {
    // 有副本时以副本为准：父进度到 1 而副本还在起，是真实出现过的中间态
    return reps.every((r) => (r.progress ?? 0) >= 1);
  }
  return false;
}

/** 0–100 的进度条数值；拿不到时返回 null（界面据此显示「未知」而不是 0%）。 */
export function percentOf(p?: LaunchProgress | null): number | null {
  if (!p) return null;
  const reps = p.replicas || [];
  const values = [
    typeof p.progress === "number" ? p.progress : null,
    ...reps.map((r) => (typeof r.progress === "number" ? r.progress : null)),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  return Math.round(Math.min(100, Math.max(0, Math.min(...values) * 100)));
}

/** 目录清单的过滤：按型号名做不区分大小写的包含匹配（清单在内存里，不必再问服务器）。 */
export function filterRegistrations(
  rows: RegisteredModel[],
  query: string,
): RegisteredModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (r.model_name || "").toLowerCase().includes(q));
}

/**
 * 已在盘上的排前面。
 *
 * 这一屏要回答的第一个问题不是「服务器认识多少型号」（实测 LLM 有 166 个），
 * 而是「现在点哪个能立刻起来、哪个要先拉几个 GB」。
 * 排序只动顺序、不动内容，且必须稳定：同名条目（内置 + 用户重复注册）不该跳来跳去。
 */
export function sortRegistrations(
  rows: RegisteredModel[],
  cached: ReadonlySet<string>,
): RegisteredModel[] {
  return [...rows].sort((a, b) => {
    const rank = (r: RegisteredModel) => (cached.has(r.model_name) ? 0 : 1);
    return rank(a) - rank(b) || a.model_name.localeCompare(b.model_name);
  });
}

/**
 * 模型 UID 的本地预检（服务器仍是最终裁判）。
 * 规则与后端 `dto.py` 一致：≤100 字符，且不能以保留后缀 `-rep<number>` 结尾 ——
 * 副本 uid 是服务器自己拼的，占用它会让「查这个 uid 的实例」撞到不该撞的东西上。
 * 返回码而不是文案：文案要跟着界面语言走（见设计文档 §12.2 那条全角括号的教训）。
 */
export function uidProblem(uid: string): "empty" | "tooLong" | "reservedSuffix" | null {
  const v = uid.trim();
  if (!v) return null; // 留空 = 用型号名，合法
  if (v.length > 100) return "tooLong";
  if (/-rep\d+$/.test(v)) return "reservedSuffix";
  return null;
}

/**
 * 上下文长度的风险判定 —— 这是 Ametrine 的加载页相对 xinference 的**实际增量**：
 * 只有我们知道运行时那个值（`.env` 的 `MAX_MODEL_LEN` 同时是发给引擎的 max_tokens
 * 和 prompt 截断预算），而 xinference 的表单看不见 .env。
 *
 * - `tooSmall`：本次填的比应用运行时要的少 ⇒ 请求会被引擎拒或中途截断。
 * - `overCap`：本次填的超过服务器声明的模型上限 ⇒ 提交必失败。
 * 拿不到的数一律返回 null（不编一个风险出来）。
 */
export function lenRisk(
  appMax: number | null | undefined,
  want: number | null | undefined,
  /** 服务器声明的上限。LLM 的版本条目里没有它（实测），所以可选 —— 拿不到就不判这一半。 */
  modelCap?: number | null,
): "tooSmall" | "overCap" | null {
  if (want == null || !Number.isFinite(want) || want <= 0) return null;
  if (typeof modelCap === "number" && modelCap > 0 && want > modelCap) return "overCap";
  if (typeof appMax === "number" && appMax > 0 && want < appMax) return "tooSmall";
  return null;
}

/**
 * T3 的透传参数：解析失败必须挡住提交。
 * 「点了没反应」的根因常常就是前端把一堆东西发出去、服务器回一句看不懂的错。
 */
export function parseExtra(
  text: string,
): { ok: true; value?: Record<string, unknown> } | { ok: false; code: "invalidJson" | "notObject" } {
  const t = text.trim();
  if (!t) return { ok: true };
  try {
    const v: unknown = JSON.parse(t);
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return { ok: false, code: "notObject" };
    }
    return { ok: true, value: v as Record<string, unknown> };
  } catch {
    return { ok: false, code: "invalidJson" };
  }
}

/** 模型在运行清单里 → 它的进度就不用再轮了。 */
export function isRunning(models: RunningModel[], uid: string): boolean {
  return models.some((m) => uidOf(m) === uid);
}

/**
 * 「这是哪 one 个实例」的写法。
 *
 * 卸载是破坏性动作，而同一型号可以开两个实例（实测：`bge-m3` 与 `bge-m3-copy` 的
 * `model_name` 都是 `bge-m3`，只有 uid 不同）。确认框里只写名字的话，用户看到的是
 * 「卸载 bge-m3？」—— 那正是被角色绑定、不该动的那一个的名字，等于让危险动作认错了对象。
 * 名字与 uid 相同时不重复一遍。
 */
export function instanceLabel(m: RunningModel): string {
  const uid = uidOf(m);
  const name = m.model_name || "";
  if (!name || name === uid) return uid || name;
  if (!uid) return name;
  return `${name} · ${uid}`;
}

const NO_UIDS: string[] = [];
const NO_MODELS: RunningModel[] = [];
const NO_ERRORS: InferenceOverview["launch_errors"] = {};

type Reading = Pick<InferenceOverview, "models" | "launch_errors"> | null | undefined;

function parts(data: Reading) {
  return {
    models: data?.models ?? NO_MODELS,
    errors: data?.launch_errors ?? NO_ERRORS,
  };
}

/**
 * 我提交过、**还没起来**的那些 —— 界面要显示的就是这些。
 *
 * 注意它包含已经失败的：失败的那一行正是「你刚才点的那一次没成，原因是……」的唯一去处。
 * 把它一起滤掉的话，那一行会无声消失，而失败原因没人再说第二遍 ——
 * 这和本项目修过好几次的「点了没反应」是同一个缺陷，只是换了个位置。
 */
export function openLaunches(launched: string[], data: Reading): string[] {
  if (!launched.length) return NO_UIDS;
  // 还没有任何读数：全部算未落定 —— 宁可多显示一行，也不要界面上什么都不说。
  if (!data) return launched;
  const { models } = parts(data);
  return launched.filter((uid) => !isRunning(models, uid));
}

/**
 * 上面那批里**还在动**的那些 —— 只用来决定要不要继续轮询。
 *
 * 失败的结论已经拿到了，就不该再为它每 2.5 秒打一次上游。
 * 两个判据分开放是刻意的：它们回答的是不同问题（「显示什么」vs「还要不要问」），
 * 合成一个就会有一边将就另一边。
 */
export function movingLaunches(launched: string[], data: Reading): string[] {
  const errors = data?.launch_errors ?? NO_ERRORS;
  return openLaunches(launched, data).filter((uid) => !errors[uid]);
}

/**
 * 目录里和「选中的规格」对得上的那条版本。
 *
 * 版本串的形状是 `{name}--{max_tokens}--{dimensions}--{model_format}--{quantization}`
 * （实测 bge-m3：`bge-m3--8192--1024--pytorch--none`），**维度**和**权重在不在盘上**只挂在它上面。
 * 取 `versions[0]` 会把 pytorch 的维度与缓存状态配到用户选中的 gguf 规格上 —— 那是编出来的数，
 * 而「维度对不对」正是换绑 embedding 时唯一的依据。
 */
export function versionForSpec(
  versions: CatalogVersion[],
  spec?: EngineSpec,
): CatalogVersion | undefined {
  if (!versions.length) return undefined;
  // 只有一条版本时没有歧义：它就是要加载的那条，谈不上「配错」。
  // 这一支存在的理由是不必为了严格匹配而把常见情况判空 —— 有的引擎规格里根本没有 model_format。
  if (versions.length === 1) return versions[0];
  if (!spec?.model_format) return undefined;
  const quant = quantOf(spec) ?? "none";
  const tail = (v: CatalogVersion) => v.model_version.split("--").slice(-2);
  return (
    versions.find((v) => {
      const [format, q] = tail(v);
      return format === spec.model_format && q === quant;
    }) ??
    // 同一格式下的别的量化 —— 维度对同一格式是同一个值，比退回「第一条」诚实。
    // **到此为止**：以前这里还有一层 `?? versions[0]`，而它正是上面那段注释禁止的东西
    // （把 pytorch 的维度与缓存状态配到用户选中的 gguf 规格上）。
    // 对不上就是没有，界面少显示一条事实，比编一条出来好。
    versions.find((v) => tail(v)[0] === spec.model_format)
  );
}

/**
 * 运行清单的两个判据：**uid 和型号名不是一回事**，不能拿一份集合两用。
 *
 * 混用的后果就躺在代码里过：清单那一行比的是 `model_name`，而「已经在跑」的集合装的是
 * `model_uid`。只要有人给实例起过别的名字（本机真有过 `bge-m3-copy`），那一行就不显示
 * 「运行中」、加载按钮也不换成「去绑定」—— 点一下等于**再开一份副本**、白占一遍显存，
 * 而「别把同一个模型启动两次」正是这个页面存在的理由之一。
 */
export function runningIndex(models: RunningModel[]): {
  uids: Set<string>;
  names: Set<string>;
} {
  const uids = new Set<string>();
  const names = new Set<string>();
  for (const m of models) {
    const uid = uidOf(m);
    if (uid) uids.add(uid);
    if (m.model_name) names.add(m.model_name);
  }
  return { uids, names };
}

/**
 * 目录里挑一条版本描述给「加载」按钮用。
 *
 * 引擎/大小/量化全部来自 `/v1/engines/{type}/{name}`，不是人手写进 .env 的：
 * 这台机器上一次「模型死活装不上」有相当一部分其实是引擎不匹配
 * （vllm 0.7.2 没有任何 Qwen3 架构），把参数交给界面选比交给 .env 诚实。
 */
export interface LaunchChoice {
  model_name: string;
  model_type: string;
  engine?: string;
  size_in_billions?: string | number;
  model_format?: string;
  quantization?: string;
}

export function describeChoice(c: LaunchChoice): string {
  const bits = [
    c.engine,
    c.size_in_billions != null ? `${c.size_in_billions}B` : null,
    c.model_format,
    c.quantization && c.quantization !== "none" ? c.quantization : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

/**
 * 一个规格条目上的量化方式。
 *
 * 服务器有时直接给 `quantization`，有时只给 `quantizations` 列表（取第一个是
 * xinference 自己表单的做法）。这个二选一此前在界面里抄了三遍 —— 抄错的后果是
 * 「界面显示的量化」和「真正发给引擎的量化」不是同一个值，而那正是最难查的一种错。
 * 注意它**不过滤 `"none"`**：`"none"` 是要如实发给引擎的值，藏起来只属于展示层。
 */
export function quantOf(s?: { quantization?: string; quantizations?: string[] } | null):
  | string
  | undefined {
  // 用 `||` 而不是 `??`：服务器对「没有量化」有时写 `"none"`、有时直接给空串。
  // 空串当有值发出去，等于用一个没人认识的量化方式去提交。
  return s?.quantization || s?.quantizations?.[0] || undefined;
}

/**
 * 活性探测结果的算术。
 *
 * 后端永远回 200 —— 三个角色里有一个打不通是「这套系统当前的状态」，
 * 不是这次请求失败了。所以「几个通、几个不通」必须由界面自己算出来并说清楚，
 * 而不是等某个 ok=false 被当成渲染异常分支漏掉。
 */
export function probeCounts(probes: LivenessProbe[] = []): {
  total: number;
  ok: number;
  bad: number;
} {
  const ok = probes.filter((p) => p.ok).length;
  return { total: probes.length, ok, bad: probes.length - ok };
}

/** 探测行的徽章颜色：没探测过与探测失败必须不是一种颜色，否则「没跑」会读成「跑通了」。 */
export function probeToneOf(
  probe?: LivenessProbe | null
): "success" | "danger" | "neutral" {
  if (!probe) return "neutral";
  return probe.ok ? "success" : "danger";
}
