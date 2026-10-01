// src/api/inference.ts
// 推理管理面的客户端。字段名一律照服务器实测形状写，不猜：
//   · /v1/models 的条目是 `{id, object, created, owned_by, **model_info}`，
//     model_info 里确定有 `model_name` / `model_type`，另有 `model_engine` / `replica`
//     （`xinference/api/restful_api.py:1385`）；uid 在 **`id`** 而不是 `model_uid`。
//   · /v1/models/{uid}/progress 实测是
//     `{progress, stage, download_files, replicas:[{replica_id, replica_model_uid, progress, stage}]}`。
//   · autostart 条目实测是 `{enabled, priority, max_retries, retry_interval_seconds, launch:{…}}`。
import { apiClient } from "./client";

export type InferenceRole = "llm" | "embedding" | "rerank";

export interface RoleBinding {
  role: InferenceRole;
  model_uid: string;
  model_name: string;
  /** true = 还在吃 .env 兜底，说明这台机器没在管理台配过绑定 */
  from_settings: boolean;
}

export interface RunningModel {
  id?: string;
  model_uid?: string;
  model_name?: string;
  model_type?: string;
  model_engine?: string;
  replica?: number;
  state?: string;
  status?: string;
}

export interface GpuReading {
  id: string;
  name?: string;
  mem_total?: number;
  mem_free?: number;
  mem_used?: number;
  mem_usage?: number;
  gpu_util?: number;
}

export interface LaunchProgress {
  progress?: number;
  stage?: string;
  download_files?: unknown[];
  replicas?: {
    replica_id?: number;
    replica_model_uid?: string;
    progress?: number;
    stage?: string;
  }[];
}

export interface AutostartEntry {
  enabled?: boolean;
  priority?: number;
  max_retries?: number;
  retry_interval_seconds?: number;
  model_uid?: string;
  launch?: { model_uid?: string; model_name?: string; model_type?: string };
}

export interface CachedWeight {
  model_name?: string;
  model_type?: string;
  model_version?: string;
  path?: string;
  real_path?: string;
  model_format?: string | null;
  quantization?: string | null;
}

export interface DownloadTask {
  cache_uid?: string;
  model_name?: string;
  model_type?: string;
  model_version?: string;
  status?: string;
  progress?: number;
  error?: string | null;
}

export interface CatalogVersion {
  model_version: string;
  dimensions?: number | null;
  max_tokens?: number | null;
  cache_status?: boolean;
  model_file_location?: Record<string, string>;
}

export interface EngineSpec {
  model_name?: string;
  model_format?: string;
  model_size_in_billions?: string | number | null;
  quantization?: string;
  quantizations?: string[];
}

export interface InferenceOverview {
  endpoint: string | null;
  version: string | null;
  reachable: boolean;
  models_error: string | null;
  models: RunningModel[];
  autostart: AutostartEntry[];
  gpu: { uptime?: number; gpus: GpuReading[] };
  downloads: DownloadTask[];
  cached: CachedWeight[];
  bindings: { roles: RoleBinding[] };
  auth: {
    auth_required: boolean | null;
    has_token: boolean;
    /** 共享句柄建了没有。句柄是惰性的，false 只代表「还没人触发第一次推理」。 */
    shared_client_built: boolean;
    expires_at: number | null;
    cooldown_until: number | null;
    last_error: string | null;
    configured: boolean;
  };
  launch_errors: Record<string, { error: string; at: number }>;
  client_has_credential: boolean;
  /**
   * **应用侧的假设**，不是服务器的事实。加载页靠它才说得出「这么开会出事」：
   * `max_model_len` 既是发给引擎的 max_tokens，也是 prompt 截断预算，
   * 所以「加载时填的上下文长度」与「运行时用的」不一致是可预见的坏 ——
   * 而只有我们知道后者（xinference 的表单看不见 .env）。
   */
  app?: {
    max_model_len?: number | null;
    top_k?: number | null;
    context_size?: number | null;
    embedding_dimension?: number | null;
  };
}

export interface LaunchBody {
  model_name: string;
  model_type: string;
  model_uid?: string;
  model_engine?: string;
  size_in_billions?: string | number;
  model_format?: string;
  quantization?: string;
  max_model_len?: number;
  replica?: number;
  n_gpu?: string;
  /**
   * 其余引擎参数**原样透传**（后端 `LaunchBody.extra` 会并进 payload）。
   * 我们不给它们做表单：实测引擎 API 只声明
   * `model_format / model_size_in_billions / quantizations / support_draft_model`，
   * 参数端点 404 —— 照抄 xinference 的表单等于手工镜像一份会过期的知识。
   * 见设计文档 §10。
   */
  extra?: Record<string, unknown>;
  autostart?: boolean;
}

export interface RegisteredModel {
  model_name: string;
  /** false = 用户自己注册的（不是 xinference 内置目录里的） */
  is_builtin?: boolean;
}

export const inferenceAPI = {
  overview: () => apiClient<InferenceOverview>("/inference/overview"),

  bindings: () => apiClient<{ roles: RoleBinding[] }>("/inference/bindings"),

  /** 换绑。失败时后端会给出「维度对不上 / 要重建」这类成句的解释，直接透出。 */
  bind: (role: InferenceRole, model_uid: string, model_name: string) =>
    apiClient<{ roles: RoleBinding[] }>(`/inference/bindings/${role}`, {
      method: "PUT",
      body: { model_uid, model_name },
    }),

  catalog: (modelType: string, modelName: string) =>
    apiClient<{ engines: Record<string, EngineSpec[]>; versions: CatalogVersion[] }>(
      `/inference/catalog?model_type=${encodeURIComponent(modelType)}` +
        `&model_name=${encodeURIComponent(modelName)}`,
    ),

  /** 目录的第一层：这个类型下服务器**认识**哪些型号（不是我们抄的一份清单）。 */
  registrations: (modelType: string) =>
    apiClient<{ model_type: string; models: RegisteredModel[] }>(
      `/inference/registrations?model_type=${encodeURIComponent(modelType)}`,
    ),

  families: () => apiClient<Record<string, string[]>>("/inference/families"),

  launch: (body: LaunchBody) =>
    apiClient<{ model_uid: string; accepted: boolean }>(`/inference/models`, {
      method: "POST",
      body,
    }),

  terminate: (uid: string) =>
    apiClient<{ model_uid: string; terminated: boolean; note?: string }>(
      `/inference/models/${encodeURIComponent(uid)}`,
      { method: "DELETE" },
    ),

  progress: (uid: string) =>
    apiClient<LaunchProgress>(
      `/inference/models/${encodeURIComponent(uid)}/progress`,
    ),

  setAutostart: (uid: string, enabled: boolean, priority?: number) =>
    enabled
      ? apiClient(`/inference/models/${encodeURIComponent(uid)}/autostart`, {
          method: "PUT",
          body: { enabled: true, ...(priority != null ? { priority } : {}) },
        })
      : apiClient(`/inference/models/${encodeURIComponent(uid)}/autostart`, {
          method: "DELETE",
        }),

  relogin: () => apiClient("/inference/auth/refresh", { method: "POST" }),

  /**
   * 活性探测：按当前绑定真的打一次 llm / embedding / rerank。
   *
   * 为什么要有这条：`/v1/models`、总览与 `/health` 证明的都是「模型登记着」，
   * 而本机事故里 worker 进了 CUDA sticky 状态之后，48/57 次请求全回**成功的空回答**，
   * 三处就绪判断一处都没变红。注册表可读 ≠ 模型可用，只有真打一次才知道。
   * 后端永远回 200（探测失败是要报告的结果，不是这次请求的失败），
   * 所以这里按数据渲染，不靠异常分支。
   */
  liveness: () =>
    apiClient<LivenessReport>("/inference/liveness", { method: "POST" }),
};

export interface LivenessProbe {
  role: InferenceRole;
  model_uid: string;
  ok: boolean;
  latency_ms: number | null;
  detail: string;
}

export interface LivenessReport {
  probes: LivenessProbe[];
  all_ok: boolean;
}
