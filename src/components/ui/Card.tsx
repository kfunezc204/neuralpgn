import type { ReactNode } from 'react'

interface CardProps {
  as?: 'div' | 'li' | 'section'
  className?: string
  children: ReactNode
}

export function Card({ as: Tag = 'div', className = '', children }: CardProps) {
  return (
    <Tag
      className={`rounded-xl border border-line bg-surface-1 transition-colors duration-150 ${className}`}
    >
      {children}
    </Tag>
  )
}
