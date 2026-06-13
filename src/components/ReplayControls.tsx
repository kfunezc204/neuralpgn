interface ReplayControlsProps {
  stepIndex: number
  totalSteps: number
  onFirst: () => void
  onPrev: () => void
  /** Omit to hide ▶ — e.g. post-completion review, where moving forward
   * means playing the move on the board yourself. */
  onNext?: () => void
  onLast: () => void
  /** Context suffix after "Paso X / Y" (e.g. 'Replay · Archivo'). */
  label?: string
}

export function ReplayControls({
  stepIndex,
  totalSteps,
  onFirst,
  onPrev,
  onNext,
  onLast,
  label,
}: ReplayControlsProps) {
  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= totalSteps - 1
  const displayed = totalSteps > 0 ? stepIndex + 1 : 0

  function btnClass(disabled: boolean) {
    return [
      'rounded-md border border-line-strong px-3 py-1 text-sm transition-colors duration-150',
      disabled
        ? 'cursor-not-allowed text-ink-faint'
        : 'text-ink-muted hover:bg-surface-3',
    ].join(' ')
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onFirst}
          disabled={atStart}
          aria-label="Primer paso"
          className={btnClass(atStart)}
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Paso anterior"
          className={btnClass(atStart)}
        >
          ◀
        </button>
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={atEnd}
            aria-label="Paso siguiente"
            className={btnClass(atEnd)}
          >
            ▶
          </button>
        )}
        <button
          type="button"
          onClick={onLast}
          disabled={atEnd}
          aria-label="Último paso"
          className={btnClass(atEnd)}
        >
          ⏭
        </button>
      </div>
      <p className="font-mono text-xs tabular-nums text-ink-muted">
        Paso {displayed} / {totalSteps}
        {label ? ` · ${label}` : ''}
      </p>
    </div>
  )
}
