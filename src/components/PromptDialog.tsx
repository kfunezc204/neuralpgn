import { useEffect, useRef, useState } from 'react'

interface PromptDialogProps {
  title: string
  /** Pre-filled value; the input arrives focused with the text selected. */
  initialValue: string
  placeholder?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title,
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canConfirm = value.trim().length > 0

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  function confirm() {
    if (!canConfirm) return
    onConfirm(value.trim())
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="view-enter relative w-full max-w-sm rounded-xl border border-line bg-surface-2 p-5 shadow-xl">
        <h2
          id="prompt-dialog-title"
          className="text-base font-semibold text-ink"
        >
          {title}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm()
          }}
          className="mt-3 w-full rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-line-strong"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-surface-3 disabled:text-ink-faint"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
