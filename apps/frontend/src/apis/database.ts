import { apiEnum } from "@/enum/apiEnum";
interface CreateDatabaseType {
  name: string
  tenant: string
}

export function getDatabaseByName(name: string) {
  return fetch(apiEnum.DATABASE_GET, {
    method: "POST",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name
    })
  })
}

export function getDatabases() {
  return fetch(apiEnum.DATABASE_GET_ALL)
}

export function createDatabase(data: CreateDatabaseType) {
  return fetch(apiEnum.DATABASE_CREATE, {
    method: "POST",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data),
  })
}