import { useEffect } from 'react'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastProps {
  message: string
  durationMs?: number
  onDismiss: () => void
  action?: ToastAction
}

export function Toast({ message, durationMs = 3000, onDismiss, action }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(t)
  }, [message, durationMs, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="view-enter pointer-events-auto flex items-center gap-3 rounded-md bg-surface-3 px-4 py-2 text-sm text-ink shadow-lg ring-1 ring-line"
    >
      <span>{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick()
            onDismiss()
          }}
          className="rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent transition-colors duration-150 hover:bg-accent-soft hover:text-accent-hover"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

interface ToastViewportProps {
  children?: React.ReactNode
}

export function ToastViewport({ children }: ToastViewportProps) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {children}
    </div>
  )
}
