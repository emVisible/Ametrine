// src/api/tenant.ts
import { apiClient } from "./client";
import type { Tenant } from "../types/knowledge";

export interface TenantMember {
  user_id: number;
  role?: string;
}

export const tenantAPI = {
  getAll: () => apiClient<Tenant[]>("/relation/tenant/all"),
  getById: (id: number) => apiClient<Tenant>(`/relation/tenant/${id}`),
  create: (data: { name: string }) =>
    apiClient<Tenant>("/relation/tenant/create", { method: "POST", body: data }),
  delete: (id: number) =>
    apiClient<{ message: string }>(`/relation/tenant/${id}`, { method: "DELETE" }),
  getMembers: (tenantId: number) =>
    apiClient<TenantMember[]>(`/relation/tenant/${tenantId}/members`),
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
