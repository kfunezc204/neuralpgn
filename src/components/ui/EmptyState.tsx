import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
