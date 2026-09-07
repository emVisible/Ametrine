// src/utils/exportChat.ts
import type { HistoryMessage } from '../stores/sessionStore'

export function exportChatAsMarkdown(title: string, messages: HistoryMessage[]): void {
  const lines: string[] = [
    `# ${title}`,
    '',
    `> 导出时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '',
  ]

  for (const msg of messages) {
    const role = msg.role === 'user' ? '**你**' : '**Ametrine**'
    lines.push(`### ${role}`)
    lines.push('')
    lines.push(msg.content)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title || '对话'}_${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}