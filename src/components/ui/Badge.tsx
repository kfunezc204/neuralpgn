import type { ReactNode } from 'react'

export type BadgeTone = 'accent' | 'ok' | 'danger' | 'neutral'

const tones: Record<BadgeTone, string> = {
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-2 text-ink-muted',
}

interface BadgeProps {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}

export function Badge({
  tone = 'neutral',
  className = '',
  children,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs tabular-nums ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
