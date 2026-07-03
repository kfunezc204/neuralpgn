import { useEffect, useRef } from 'react'

export type ConfirmDialogVariant = 'default' | 'danger'

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  variant?: ConfirmDialogVariant
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirmClasses =
    variant === 'danger'
      ? 'bg-danger text-surface-0 hover:bg-danger/85 focus:ring-danger'
      : 'bg-accent text-accent-contrast hover:bg-accent-hover focus:ring-accent'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="view-enter relative w-full max-w-sm rounded-xl border border-line bg-surface-2 p-5 shadow-xl">
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold text-ink"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-line-strong"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
