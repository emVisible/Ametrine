// src/api/chat.ts
import useAuthStore from "../stores/useAuthStore";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000/api";

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
  rerank?: boolean;
}

/**
 * 后端把「模型未加载」「Milvus 不可用」都表现为裸 500，直接展示 HTTP 码对用户没有意义。
 * 这里把状态码翻译成可行动的中文提示。
 */
export function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return "请求不被接受，请检查输入内容或集合选择";
    case 401:
      return "登录已过期，请重新登录";
    case 403:
      return "没有访问该知识库的权限";
    case 404:
      return "接口或所选集合不存在";
    case 500:
      return "后端处理失败，通常是模型尚未加载或向量库不可用。可检查 Xinference 与 Milvus 是否就绪后重试";
    case 502:
    case 503:
    case 504:
      return "后端或模型服务暂时不可用，请稍后重试";
    default:
      return `请求失败（HTTP ${status}）`;
  }
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function onUnauthorized(): never {
  // 清态即可，路由层的 ProtectedRoute 负责跳回登录页
  useAuthStore.getState().logout();
  throw new Error("登录已过期，请重新登录");
}

/** 后端可能以 SSE 帧（`data: {...}`）或 NDJSON 行返回，两种都要能解。 */
function parseDataLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  const payload = trimmed.startsWith("data:")
    ? trimmed.slice(5).trim()
    : trimmed;
  if (!payload || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.content === "string") return parsed.content;
      if (typeof parsed.token === "string") return parsed.token;
      if (typeof parsed.delta === "string") return parsed.delta;
    }
    return null;
  } catch {
    // 不是 JSON 的行按纯文本 token 处理，避免流被静默丢弃
    return payload;
  }
}

async function readStream(
  response: Response,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    onError(new Error("当前浏览器不支持流式读取"));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const token = parseDataLine(line);
        if (token) onToken(token);
      }
    }
    const tail = parseDataLine(buffer);
    if (tail) onToken(tail);
    onComplete();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      onComplete();
      return;
    }
    onError(error instanceof Error ? error : new Error("读取数据流失败"));
  }
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
    onError(error instanceof Error ? error : new Error("请求失败"));
    return;
  }

  if (response.status === 401) onUnauthorized();
  if (!response.ok) {
    onError(new Error(describeStatus(response.status)));
    return;
  }

  await readStream(response, onToken, onComplete, onError);
}

export async function streamRAG(
  dto: RAGRequest,
  onToken: (token: string) => void,
  onComplete: (references?: unknown[]) => void,
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
    onError(error instanceof Error ? error : new Error("请求失败"));
    return;
  }

  if (response.status === 401) onUnauthorized();
  if (response.status === 403) {
    const detail = await response.json().catch(() => ({ message: "" }));
    onError(
      new Error(detail.message || detail.detail || "没有访问该知识库的权限"),
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

  await readStream(response, onToken, () => onComplete(references), onError);
}
