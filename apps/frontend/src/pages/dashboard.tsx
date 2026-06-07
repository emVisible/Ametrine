// src/pages/Dashboard.tsx
import { useCurrentUser } from '../hooks/useAuth'
import useAuthStore from '../stores/useAuthStore'
import { useNavigate } from 'react-router'

export default function Dashboard() {
  const { data: user, isLoading } = useCurrentUser()
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-semibold text-gray-900">仪表盘</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {user?.name} ({user?.email})
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 欢迎卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            欢迎回来，{user?.name}
          </h2>
          <p className="text-gray-600">
            这是你的个人仪表盘，你可以在这里管理你的内容。
          </p>
        </div>

        {/* 快捷操作区 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <QuickCard
            title="个人资料"
            description="查看和编辑你的个人信息"
            color="blue"
          />
          <QuickCard
            title="我的权限"
            description={`当前拥有 ${user?.permissions?.length || 0} 项权限`}
            color="green"
          />
          <QuickCard
            title="系统设置"
            description="管理应用偏好和通知"
            color="purple"
          />
        </div>

        {/* 权限列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">你的权限</h3>
          <div className="flex flex-wrap gap-2">
            {user?.permissions?.map((perm) => (
              <span
                key={perm}
                className="px-3 py-1 text-sm font-medium bg-indigo-100 text-indigo-700 rounded-full"
              >
                {perm}
              </span>
            )) || (
              <span className="text-sm text-gray-500">暂无权限</span>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// 快捷操作卡片组件
function QuickCard({
  title,
  description,
  color,
}: {
  title: string
  description: string
  color: 'blue' | 'green' | 'purple'
}) {
  const colorMap = {
    blue: 'border-l-4 border-l-blue-500 hover:shadow-blue-50',
    green: 'border-l-4 border-l-green-500 hover:shadow-green-50',
    purple: 'border-l-4 border-l-purple-500 hover:shadow-purple-50',
  }

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 ${colorMap[color]} hover:shadow-md transition-shadow cursor-pointer`}
    >
      <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  )
}