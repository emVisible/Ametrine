import { apiEnum } from "@/enum/apiEnum";
import { ragChat, RAGRequestType } from "./rag";

export interface LLMRequestType {
  prompt: string
  mode?: 'llm' | 'rag'
  system_prompt?: string
  chat_history?: Message[]
}
interface Message {
  role: string;
  content: string;
  user?: string
  tool_calls?: string[]
}

export async function llmChat(data: LLMRequestType) {
  const { prompt, chat_history, system_prompt } = data
  return fetch(apiEnum.LLM_CHAT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      system_prompt,
      chat_history
    }),
  })
}

export async function chat(data: RAGRequestType) {
  const { mode } = data
  if (mode === 'llm') return llmChat(data)
  else return ragChat(data)
}