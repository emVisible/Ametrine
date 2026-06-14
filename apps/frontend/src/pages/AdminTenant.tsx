// src/pages/AdminTenant.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantAPI } from '../api/tenant'
import { useNavigate } from 'react-router'

export default function AdminTenantPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [tenantName, setTenantName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    database: '',
    description: '',
  })

  const createMutation = useMutation({
    mutationFn: () => tenantAPI.create({ name: tenantName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      setShowCreate(false)
      setTenantName('')
    },
  })

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantAPI.getAll,
  })


  const deleteMutation = useMutation({
    mutationFn: (id: number) => tenantAPI.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants'] }),
  })

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        {/* 顶部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">租户管理</h1>
            <p className="text-sm text-gray-500 mt-1">管理多租户及其关联的知识库</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            {showCreate ? '取消' : '创建租户'}
          </button>
        </div>

        {showCreate && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">租户名称</label>
              <input
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="例如：研发部"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !tenantName}
              className="mt-3 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {createMutation.isPending ? '创建中...' : '确认创建'}
            </button>
          </div>
        )}

        {/* 租户列表 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">租户名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">关联知识库</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tenants?.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-400">
                      暂无租户，点击上方按钮创建
                    </td>
                  </tr>
                ) : (
                  tenants?.map((tenant: any) => (
                    <tr key={tenant.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{tenant.id}</td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-gray-900">{tenant.name}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{tenant.database}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteMutation.mutate(tenant.id)}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}