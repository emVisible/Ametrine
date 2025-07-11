import { apiEnum } from "@/enum/apiEnum";
export async function agentCommunication(query: string) {
  return fetch(`${apiEnum.AGENT_COMMUNICATION}?query=${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
  })
}