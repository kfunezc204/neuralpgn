import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'

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
      'inline-flex items-center justify-center rounded-md border border-line-strong px-3 py-1.5 transition-colors duration-150',
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
          aria-label="First step"
          className={btnClass(atStart)}
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous step"
          className={btnClass(atStart)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={atEnd}
            aria-label="Next step"
            className={btnClass(atEnd)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onLast}
          disabled={atEnd}
          aria-label="Last step"
          className={btnClass(atEnd)}
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
      <p className="font-mono text-xs tabular-nums text-ink-muted">
        Step {displayed} / {totalSteps}
        {label ? ` · ${label}` : ''}
      </p>
    </div>
  )
}
