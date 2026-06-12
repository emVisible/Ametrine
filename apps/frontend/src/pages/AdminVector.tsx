// src/pages/AdminVector.tsx
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { databaseAPI, collectionAPI, documentAPI } from '../api/rag'

export default function AdminVectorPage() {
  const [activeTab, setActiveTab] = useState<'databases' | 'collections' | 'documents'>('databases')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white">
        <div className="justify-between max-w-7xl mx-auto px-4">
          <div className="flex gap-6">
            {[
              { key: 'databases', label: '数据库' },
              { key: 'collections', label: '集合' },
              { key: 'documents', label: '文档' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'databases' && <DatabaseManager />}
        {activeTab === 'collections' && <CollectionManager />}
        {activeTab === 'documents' && <DocumentManager />}
      </main>
    </div>
  )
}

// ─── 数据库管理 ───
function DatabaseManager() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data: databases, isLoading } = useQuery({
    queryKey: ['pg-databases'],
    queryFn: databaseAPI.getAll,
  })

  const createMutation = useMutation({
    mutationFn: () => databaseAPI.create({ name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pg-databases'] })
      setShowCreate(false)
      setName('')
      setDescription('')
    },
  })

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">知识库列表</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        >
          {showCreate ? '取消' : '创建知识库'}
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
          <input placeholder="知识库名称" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm" />
          <input placeholder="描述" value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm" />
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
            {createMutation.isPending ? '创建中...' : '确认创建'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : (
        <div className="grid gap-3">
          {databases?.map((db: any) => (
            <div key={db.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium text-gray-900">{db.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{db.description || '暂无描述'}</p>
                  {db.tenant && <p className="text-xs text-gray-400 mt-1">租户: {db.tenant.name}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${db.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                  {db.is_active ? '活跃' : '停用'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 集合管理 ───
function CollectionManager() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedDbId, setSelectedDbId] = useState<number | null>(null)

  const { data: databases } = useQuery({
    queryKey: ['pg-databases'],
    queryFn: databaseAPI.getAll,
  })

  const { data: collections, isLoading } = useQuery({
    queryKey: ['pg-collections', selectedDbId],
    queryFn: () => collectionAPI.getByDatabase(selectedDbId!),
    enabled: !!selectedDbId,
  })

  const createMutation = useMutation({
    mutationFn: () => collectionAPI.create({ name, database_id: selectedDbId!, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pg-collections', selectedDbId] })
      setShowCreate(false)
      setName('')
      setDescription('')
    },
  })

  return (
    <div>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">选择知识库</label>
        <select value={selectedDbId ?? ''} onChange={(e) => setSelectedDbId(Number(e.target.value) || null)}
          className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">-- 选择知识库 --</option>
          {databases?.map((db: any) => (
            <option key={db.id} value={db.id}>{db.name}</option>
          ))}
        </select>
      </div>

      {selectedDbId && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">集合列表</h2>
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              {showCreate ? '取消' : '创建集合'}
            </button>
          </div>

          {showCreate && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
              <input placeholder="集合名称" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input placeholder="描述" value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
              <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
                {createMutation.isPending ? '创建中...' : '确认创建'}
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : (
            <div className="grid gap-3">
              {collections?.map((col: any) => (
                <div key={col.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">{col.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{col.description || '暂无描述'}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── 文档管理 ───
function DocumentManager() {
  const [selectedDbId, setSelectedDbId] = useState<number | null>(null)
  const [selectedColId, setSelectedColId] = useState<number | null>(null)
  const [uploadStatus, setUploadStatus] = useState('')
  const [viewingChunks, setViewingChunks] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: databases } = useQuery({
    queryKey: ['pg-databases'],
    queryFn: databaseAPI.getAll,
  })

  const { data: collections } = useQuery({
    queryKey: ['pg-collections', selectedDbId],
    queryFn: () => collectionAPI.getByDatabase(selectedDbId!),
    enabled: !!selectedDbId,
  })

  const { data: documents, isLoading } = useQuery({
    queryKey: ['pg-documents', selectedColId],
    queryFn: () => documentAPI.getByCollection(selectedColId!),
    enabled: !!selectedColId,
  })

  const { data: chunks } = useQuery({
    queryKey: ['pg-chunks', viewingChunks],
    queryFn: () => documentAPI.getChunks(viewingChunks!),
    enabled: !!viewingChunks,
  })

  const selectedDb = databases?.find((db: any) => db.id === selectedDbId)
  const selectedCol = collections?.find((col: any) => col.id === selectedColId)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedCol || !selectedDb) return

    setUploadStatus('上传中...')
    try {
      await documentAPI.upload(file, selectedCol.name, selectedDb.name)
      setUploadStatus('上传成功！')
      // 刷新文档列表
      window.location.reload()
    } catch (error) {
      setUploadStatus(`上传失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">知识库</label>
          <select value={selectedDbId ?? ''} onChange={(e) => { setSelectedDbId(Number(e.target.value) || null); setSelectedColId(null) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">-- 选择知识库 --</option>
            {databases?.map((db: any) => (
              <option key={db.id} value={db.id}>{db.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">集合</label>
          <select value={selectedColId ?? ''} onChange={(e) => setSelectedColId(Number(e.target.value) || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" disabled={!selectedDbId}>
            <option value="">-- 选择集合 --</option>
            {collections?.map((col: any) => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedDbId && selectedColId && (
        <>
          <div className="bg-white rounded-xl border-2 border-dashed border-gray-300 p-8 text-center mb-6">
            <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.html,.epub,.odt,.eml" />
            <button onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              选择文件上传
            </button>
            <p className="mt-2 text-sm text-gray-500">支持 PDF、Word、TXT、Markdown、CSV 等格式</p>
            {uploadStatus && (
              <p className={`mt-2 text-sm ${uploadStatus.includes('成功') ? 'text-green-600' : 'text-red-600'}`}>
                {uploadStatus}
              </p>
            )}
          </div>

          {/* 文档列表 */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : (
            <div className="space-y-3">
              {documents?.map((doc: any) => (
                <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">{doc.title}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        上传者: {doc.uploader} · {doc.created_at?.slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${doc.meta?.index_status === 'indexed'
                        ? 'bg-green-100 text-green-700'
                        : doc.meta?.index_status === 'pending'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                        }`}>
                        {doc.meta?.index_status || '未知'}
                      </span>
                      <button onClick={() => setViewingChunks(viewingChunks === doc.id ? null : doc.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-800">
                        {viewingChunks === doc.id ? '收起分块' : '查看分块'}
                      </button>
                    </div>
                  </div>

                  {/* 分块详情 */}
                  {viewingChunks === doc.id && (
                    <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                      {chunks?.map((chunk: any, i: number) => (
                        <div key={chunk.id} className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700">
                          <span className="text-gray-400 mr-2">#{i + 1}</span>
                          {chunk.content?.slice(0, 200)}{chunk.content?.length > 200 ? '...' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}