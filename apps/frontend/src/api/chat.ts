// src/api/chat.ts
import useAuthStore from "../stores/useAuthStore";
import { t } from "../i18n";
import { API_BASE } from "./base";

export interface StreamMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  prompt: string;
  chat_history: StreamMessage[];
}

export interface RAGRequest extends ChatRequest {
  database_name: string;
  collection_name: string;
  /** 后端 DTO 已有这两个字段，开关才不再是装饰 */
  rerank?: boolean;
  top_k?: number;
  /** 跨知识库检索：给了多项就按多路召回 + RRF 融合走，
   *  缺省或只有一项时后端退回上面那两个标量字段。 */
  sources?: { database_name: string; collection_name: string }[];
}

/**
 * 后端把「模型未加载」「Milvus 不可用」都表现为裸 500，直接展示 HTTP 码对用户没有意义。
 * 这里把状态码翻译成当前语言里可行动的提示。
 */
export function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return t("errors.badRequest");
    case 401:
      return t("errors.unauthorized");
    case 403:
      return t("errors.forbidden");
    case 404:
      return t("errors.notFound");
    case 500:
      return t("errors.serverError");
    case 502:
    case 503:
    case 504:
      return t("errors.unavailable");
    default:
      return t("errors.fallback", { status });
  }
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function onUnauthorized(): never {
  // 清态即可，路由层的 ProtectedRoute 负责跳回登录页
  useAuthStore.getState().logout();
  throw new Error(t("errors.unauthorized"));
}

/** 后端在流里报的错（上游模型中断、块间空闲超时）是 `{"error": "…"}` 这样一行。 */
type StreamEvent = { kind: "token"; text: string } | { kind: "error"; message: string };

/** 后端可能以 SSE 帧（`data: {...}`）或 NDJSON 行返回，两种都要能解。 */
export function parseDataLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  const payload = trimmed.startsWith("data:")
    ? trimmed.slice(5).trim()
    : trimmed;
  if (!payload || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed === "string") return parsed ? { kind: "token", text: parsed } : null;
    if (parsed && typeof parsed === "object") {
      // 这一支必须排在 content 之前：错误行没有 content，过去它被当成「没内容的行」
      // 静默丢掉，于是模型中途死掉时界面留下的是一条看起来正常的空白气泡。
      if (typeof parsed.error === "string" && parsed.error) {
        return { kind: "error", message: parsed.error };
      }
      if (typeof parsed.content === "string") return { kind: "token", text: parsed.content };
      if (typeof parsed.token === "string") return { kind: "token", text: parsed.token };
      if (typeof parsed.delta === "string") return { kind: "token", text: parsed.delta };
    }
    return null;
  } catch {
    // 不是 JSON 的行按纯文本 token 处理，避免流被静默丢弃
    return payload ? { kind: "token", text: payload } : null;
  }
}

/**
 * 读一路推理流。三种结局，各归其一：
 * · 有内容且流正常结束 → onComplete
 * · 流里出现 error 行 → onError（把服务端那句可行动的解释原样带上）
 * · 流结束却一个 token 都没有 → onError。这不是理论分支：上游 worker 进入
 *   sticky CUDA 错误之后，后端就是这么「200 + 空体」结束的。
 */
export async function readStream(
  response: Response,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    onError(new Error(t("errors.noStream")));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sawToken = false;
  let streamError: string | null = null;

  const consume = (line: string): void => {
    const event = parseDataLine(line);
    if (!event) return;
    if (event.kind === "error") {
      streamError = event.message;
      return;
    }
    if (event.text) {
      sawToken = true;
      onToken(event.text);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(buffer);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      onComplete();
      return;
    }
    onError(error instanceof Error ? error : new Error(t("errors.readFailed")));
    return;
  }

  if (streamError) {
    onError(new Error(streamError));
    return;
  }
  if (!sawToken) {
    onError(new Error(t("errors.emptyStream")));
    return;
  }
  onComplete();
}

export async function streamChat(
  dto: ChatRequest,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/llm/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(dto),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    onError(error instanceof Error ? error : new Error(t("errors.requestFailed")));
    return;
  }

  if (response.status === 401) onUnauthorized();
  if (!response.ok) {
    onError(new Error(describeStatus(response.status)));
    return;
  }

  await readStream(response, onToken, onComplete, onError);
}

/**
 * 跨库检索的来源清单：把「这个用户可读的库 × 它们的集合」摊平成 sources。
 *
 * 只有一路可选时返回 `undefined` —— 后端因此走原来的标量路径，
 * 界面上也不会出现一个开了没反应的开关。这是纯函数，所以它能被单测钉住，
 * 不必靠隐藏标签页里的视口尺寸去猜。
 */
export function buildCrossBaseSources(
  databases: { id: number; name: string }[],
  collectionsByDb: Map<number, { name: string }[]>,
): { database_name: string; collection_name: string }[] | undefined {
  const list: { database_name: string; collection_name: string }[] = [];
  for (const db of databases) {
    for (const col of collectionsByDb.get(db.id) ?? []) {
      list.push({ database_name: db.name, collection_name: col.name });
    }
  }
  return list.length > 1 ? list : undefined;
}

export async function streamRAG(
  dto: RAGRequest,
  onToken: (token: string) => void,
  onComplete: (references?: unknown[], retrievalSession?: string) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/llm/rag`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(dto),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    onError(error instanceof Error ? error : new Error(t("errors.requestFailed")));
    return;
  }

  if (response.status === 401) onUnauthorized();
  // 403（没权限）与 409（这些库的 embedding 模型不一致，跨库混排没有意义）
  // 都是后端**刻意为之**的拒绝，它的 message 就是给人看的可执行说明，
  // 所以直接把服务端文案透出，而不是套一层通用错误。
  if (response.status === 403 || response.status === 409) {
    const detail = await response.json().catch(() => ({ message: "" }));
    onError(
      new Error(
        detail.message ||
          detail.detail ||
          (response.status === 403 ? t("errors.forbidden") : t("errors.conflict")),
      ),
    );
    return;
  }
  if (!response.ok) {
    onError(new Error(describeStatus(response.status)));
    return;
  }

  // 引用来源走响应头回传，必须在读流之前取出
  const sessionId = response.headers.get("X-Session-ID");
  let references: unknown[] = [];
  if (sessionId) {
    try {
      const refResponse = await fetch(
        `${API_BASE}/llm/references?session_id=${encodeURIComponent(sessionId)}`,
        { headers: authHeaders(), signal },
      );
      const result = await refResponse.json();
      references = result.data || result;
    } catch {
      /* 引用缺失不影响正文流 */
    }
  }

  await readStream(
    response,
    onToken,
    () => onComplete(references, sessionId || undefined),
    onError,
  );
}
