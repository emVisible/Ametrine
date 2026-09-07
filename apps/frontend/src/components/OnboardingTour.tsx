import { useState } from 'react'

interface Step {
  title: string
  description: string
  icon: string
}

const steps: Step[] = [
  {
    title: '创建知识库',
    description: '知识库是 RAG 检索的基础。在知识库管理页面创建一个数据库，并为它绑定租户。',
    icon: '📚',
  },
  {
    title: '上传文档',
    description: '在知识库中上传 PDF、Word、Markdown 等文档，系统会自动分块并建立向量索引。',
    icon: '📄',
  },
  {
    title: '开始 RAG 对话',
    description: '选择知识库和集合，输入问题即可基于你的文档进行智能检索和回答。',
    icon: '🔍',
  },
]

export default function OnboardingTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)

  const current = steps[step]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
        <div className="text-5xl mb-4">{current.icon}</div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
          {current.title}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {current.description}
        </p>

        {/* 步骤指示器 */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>

        <div className="flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              上一步
            </button>
          )}
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              下一步
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              开始使用
            </button>
          )}
        </div>
      </div>
    </div>
  )
}