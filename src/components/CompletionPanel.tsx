import type { ReactNode } from 'react'
import {
  computeAccuracyPercent,
  formatDueIn,
  formatSolveTime,
} from '../lib/CompletionStats.ts'
import type { WalkMode } from '../lib/TabModeResolver.ts'
import type { WalkCompletionStats } from './WalkCore.tsx'

const RATING_LABEL: Record<
  'pass_all_first' | 'pass_with_retry' | 'fail',
  string
> = {
  pass_all_first: 'Good',
  pass_with_retry: 'Hard',
  fail: 'Again',
}

const RATING_CLASS: Record<
  'pass_all_first' | 'pass_with_retry' | 'fail',
  string
> = {
  pass_all_first: 'text-ok',
  pass_with_retry: 'text-accent',
  fail: 'text-danger',
}

interface CompletionPanelProps {
  mode: WalkMode
  stats: WalkCompletionStats
  now: Date
  /** Challenge course: the quiz summary includes the solve time. */
  showSolveTime?: boolean
  onNavigateNext?: () => void
  onExit?: () => void
  /** Post-completion review stepper, rendered between summary and actions. */
  reviewControls?: ReactNode
  /** Contextual next-step offer (weak points, free cycle) shown with Actions. */
  extraActions?: ReactNode
}

// Compact completion summary rendered in the status area under the board, so
// the board stays fully visible showing the line's final position.
export function CompletionPanel({
  mode,
  stats,
  now,
  showSolveTime = false,
  onNavigateNext,
  onExit,
  reviewControls,
  extraActions,
}: CompletionPanelProps) {
  return (
    <div>
      <p className="text-sm font-medium text-ink">
        <Summary
          mode={mode}
          stats={stats}
          now={now}
          showSolveTime={showSolveTime}
        />
      </p>
      {reviewControls && <div className="mt-3">{reviewControls}</div>}
      <Actions
        onNavigateNext={onNavigateNext}
        onExit={onExit}
        extraActions={extraActions}
      />
    </div>
  )
}

function Summary({
  mode,
  stats,
  now,
  showSolveTime,
}: {
  mode: WalkMode
  stats: WalkCompletionStats
  now: Date
  showSolveTime: boolean
}) {
  if (mode === 'refresher') {
    return <>✓ Line completed — nothing written to SRS</>
  }
  if (mode === 'teach') {
    return <>✓ Line learned — it will show up in your next review</>
  }

  // quiz
  const accuracy = computeAccuracyPercent({
    totalQuizzed: stats.totalQuizzed,
    retriesUsed: stats.retriesUsed,
  })
  const dueIn = stats.lineState ? formatDueIn(stats.lineState.due, now) : null
  return (
    <>
      ✓ Line completed —{' '}
      <span className={`font-semibold ${RATING_CLASS[stats.outcome]}`}>
        {RATING_LABEL[stats.outcome]}
      </span>{' '}
      · {accuracy}%
      {showSolveTime && stats.durationMs !== undefined && (
        <> · solved in {formatSolveTime(stats.durationMs)}</>
      )}
      {dueIn !== null && <> · review in {dueIn}</>}
    </>
  )
}

function Actions({
  onNavigateNext,
  onExit,
  extraActions,
}: {
  onNavigateNext?: () => void
  onExit?: () => void
  extraActions?: ReactNode
}) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      {extraActions}
      {onNavigateNext && (
        <button
          type="button"
          onClick={onNavigateNext}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover"
        >
          Next line →
        </button>
      )}
      {onExit && (
        <button
          type="button"
          onClick={onExit}
          className="rounded-md border border-line-strong px-3 py-2 text-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2"
        >
          Exit
        </button>
      )}
    </div>
  )
}
