// src/api/tenant.ts
import { apiClient } from "./client";
import type { Tenant, TenantOverview } from "../types/knowledge";

export const tenantAPI = {
  getAll: () => apiClient<Tenant[]>("/relation/tenant/all"),
  /** 融合面板的唯一数据源：租户 × 成员 × 知识库 × 授权，一次请求 */
  getOverview: () => apiClient<TenantOverview>("/relation/tenant/overview"),
  create: (data: { name: string }) =>
    apiClient<Tenant>("/relation/tenant/create", { method: "POST", body: data }),
  delete: (id: number) =>
    apiClient<{ message: string }>(`/relation/tenant/${id}`, { method: "DELETE" }),
  addMember: (tenantId: number, userId: number, role = "member") =>
    apiClient(`/relation/tenant/${tenantId}/members/${userId}`, {
      method: "POST",
      body: { role },
    }),
  removeMember: (tenantId: number, userId: number) =>
    apiClient(`/relation/tenant/${tenantId}/members/${userId}`, {
      method: "DELETE",
    }),
};
