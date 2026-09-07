import { apiClient } from './client'

export const tenantAPI = {
  getAll: () => apiClient<any[]>('/relation/tenant/all'),
  getById: (id: number) => apiClient<any>(`/relation/tenant/${id}`),
  create: (data: { name: string }) =>
    apiClient('/relation/tenant/create', { method: 'POST', body: data }),
  delete: (id: number) =>
    apiClient(`/relation/tenant/${id}`, { method: 'DELETE' }),
  getMembers: (tenantId: number) =>
    apiClient<any[]>(`/relation/tenant/${tenantId}/members`),
  addMember: (tenantId: number, userId: number, role: string = 'member') =>
    apiClient(`/relation/tenant/${tenantId}/members/${userId}`, {
      method: 'POST',
      body: { role },
    }),
  removeMember: (tenantId: number, userId: number) =>
    apiClient(`/relation/tenant/${tenantId}/members/${userId}`, { method: 'DELETE' }),
}