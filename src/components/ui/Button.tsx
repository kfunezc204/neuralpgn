import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-2 disabled:text-ink-faint'

const sizes: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary:
    'border border-line-strong bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger:
    'border border-danger/30 bg-danger-soft text-danger hover:bg-danger/20',
}

// Class builder so <Link> and aria-disabled <span> pills can share the exact
// button look without nesting interactive elements.
export function buttonClasses(opts?: {
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
}): string {
  const { variant = 'secondary', size = 'md', disabled = false } = opts ?? {}
  if (disabled) {
    return `${base} ${sizes[size]} cursor-not-allowed bg-surface-2 text-ink-faint`
  }
  return `${base} ${sizes[size]} ${variants[variant]}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClasses({ variant, size })} ${className}`}
      {...rest}
    />
  )
}
