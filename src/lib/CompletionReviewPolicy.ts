import type { WalkMode } from './TabModeResolver.ts'
import type { LineOutcome } from './types.ts'

// Post-completion review: replay-style move stepping offered on the 'done'
// screen. Study modes (teach, refresher) always merit one more pass; a quiz
// only when something went wrong (Hard/Again) — a perfect quiz keeps the
// friction-free chained flow. Replay never reaches 'done'.
export function shouldOfferCompletionReview(
  mode: WalkMode,
  outcome: LineOutcome,
): boolean {
  if (mode === 'teach' || mode === 'refresher') return true
  if (mode === 'quiz') return outcome !== 'pass_all_first'
  return false
}

export type ReviewNavAction = 'first' | 'prev' | 'next' | 'last'

/**
 * Review cursor over a completed line. Indices 0..total-1 are the line's
 * steps (position before the user's move, move highlighted, like replay
 * mode); `null` is the resting state — the real final position the
 * completion screen already shows. 'last'/'next' past the end return to it,
 * so stepping is fully reversible.
 */
export function stepCompletionReview(
  current: number | null,
  action: ReviewNavAction,
  total: number,
): number | null {
  if (total <= 0) return null
  switch (action) {
    case 'first':
      return 0
    case 'last':
      return null
    case 'prev':
      if (current === null) return total - 1
      return Math.max(0, current - 1)
    case 'next':
      if (current === null) return null
      return current + 1 >= total ? null : current + 1
  }
}
