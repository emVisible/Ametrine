// src/utils/exportChat.ts
import type { HistoryMessage } from '../stores/sessionStore'
import { t, intlLocale } from '../i18n'

export function exportChatAsMarkdown(title: string, messages: HistoryMessage[]): void {
  const lines: string[] = [
    `# ${title}`,
    '',
    `> ${t('export.exportedAt', { time: new Date().toLocaleString(intlLocale()) })}`,
    '',
    '---',
    '',
  ]

  for (const msg of messages) {
    const role = msg.role === 'user' ? t('common.you') : t('app.name')
    lines.push(`### **${role}**`)
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
  a.download = `${title || t('page.chat')}_${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}