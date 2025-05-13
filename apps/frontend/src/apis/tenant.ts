import { apiEnum } from "@/enum/apiEnum";

export function getTenantByName(name: string) {
  return fetch(apiEnum.TENANT_GET, {
    method: "POST",
    body: JSON.stringify({
      name
    }),
    headers: {
      "Content-Type": "application/json"
    }
  })
}

export function getTenants() {
  return fetch(apiEnum.TENANT_GET_ALL).then(res=>res.json())
}

export function createTenant(name: string, database: string) {
  return fetch(apiEnum.TENANT_CREATE, {
    method: "POST",
    body: JSON.stringify({
      name,
      database
    }),
    headers: {
      "Content-Type": "application/json"
    }
  })
}