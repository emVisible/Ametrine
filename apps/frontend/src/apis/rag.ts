import { apiEnum } from "@/enum/apiEnum";
import { BaseResponse } from "./base";

export interface RAGRequestType {
  prompt: string
  collection_name: string
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

export async function ragChat(data: RAGRequestType) {
  const { prompt, chat_history, system_prompt, collection_name } = data
  return fetch(apiEnum.RAG_CHAT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      system_prompt,
      chat_history,
      collection_name
    }),
  })
}

export async function getReferenceData(session_id: string):Promise<BaseResponse<any>> {
  return fetch(apiEnum.GET_REFERENCE_DATA + "?session_id=" + session_id).then((res) => res.json())
}