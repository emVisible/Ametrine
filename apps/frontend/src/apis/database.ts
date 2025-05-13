import { apiEnum } from "@/enum/apiEnum";
import { BaseResponse } from "./base";
interface CreateDatabaseType {
  db_name: string
  tenant_name: string
  replica_number: number
}


export function getDatabases(): Promise<BaseResponse<string[]>> {
  return fetch(apiEnum.DATABASE_GET_ALL).then(res => res.json())
}

export function getDatabaseDetail(name: string): Promise<BaseResponse<any>> {
  return fetch(apiEnum.DATABASE_GET, {
    method: "POST",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      db_name:name
    })
  }).then(res => res.json())
}

export function getDatabasesDetail() {
  return fetch(apiEnum.DATABASE_GET_Details).then(res => res.json())
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