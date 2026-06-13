interface SelectionBulkBarAction {
  label: string
  onClick: () => void
  danger?: boolean
}

interface SelectionBulkBarProps {
  count: number
  actions: SelectionBulkBarAction[]
  onCancel: () => void
}

export function SelectionBulkBar({
  count,
  actions,
  onCancel,
}: SelectionBulkBarProps) {
  return (
    <div className="border-t border-line bg-surface-2 px-2 py-2 shadow-[0_-2px_8px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ink-muted">
          {count} sel
        </span>
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                action.danger
                  ? 'bg-danger-soft text-danger hover:bg-danger/25'
                  : 'bg-surface-3 text-ink hover:bg-line-strong'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar selección"
          className="rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-3"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
