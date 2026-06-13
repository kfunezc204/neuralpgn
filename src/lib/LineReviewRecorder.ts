import { LineScheduler } from './LineScheduler.ts'
import type { LogReviewEventInput, PersistedLineState } from './Repository.ts'
import type { LineOutcome, LineSrsState, LineSrsStateName } from './types.ts'

// The line outcome → FSRS rating mapping used when writing a review event.
// (The scheduler maps outcome → rating internally too; this is the value we log
// alongside the event for history/analytics.)
const OUTCOME_RATING: Record<LineOutcome, 'Good' | 'Hard' | 'Again'> = {
  pass_all_first: 'Good',
  pass_with_retry: 'Hard',
  fail: 'Again',
}

// The minimum a recorder needs to commit a review. Repository satisfies this
// structurally; tests pass a fake. This is the seam that keeps the SRS-write
// boundary unit-testable without a database.
export interface LineReviewSink {
  saveLineState(
    lineId: number,
    state: LineSrsState,
    profileId?: string,
  ): Promise<void>
  logReviewEvent(input: LogReviewEventInput): Promise<void>
}

export interface CommitLineReviewParams {
  sink: LineReviewSink
  lineId: number
  /** Prior SRS state for this line, or null for a first review. */
  prior: PersistedLineState | null
  outcome: LineOutcome
  retriesUsed: number
  /** Wall time of the quiz walk in ms; omitted for non-timed paths. */
  durationMs?: number
  now?: Date
  profileId?: string
  /** Injectable for tests; defaults to a fresh FSRS scheduler. */
  scheduler?: LineScheduler
}

/**
 * Advance one line's SRS state for an outcome and persist it: schedule the next
 * state, save it, and log the review event — atomically from the caller's view.
 * Returns the saved state so callers can show post-review stats without a
 * re-read.
 *
 * This is the ONLY place the schedule→save→log sequence lives. WalkCore and
 * GlobalWalkView both route through it; the "only persist on natural
 * completion" guard stays with each caller (it is about *when* to call this,
 * not *how* to commit).
 */
export async function commitLineReview(
  params: CommitLineReviewParams,
): Promise<PersistedLineState> {
  const {
    sink,
    lineId,
    prior,
    outcome,
    retriesUsed,
    durationMs,
    now = new Date(),
    profileId = 'default',
    scheduler = new LineScheduler(),
  } = params

  const base: LineSrsState = prior
    ? {
        stability: prior.stability,
        difficulty: prior.difficulty,
        due: prior.due,
        state: prior.state,
        reps: prior.reps,
        lapses: prior.lapses,
        consecutive_correct: prior.consecutive_correct,
        learning_steps: prior.learning_steps,
        ...(prior.last_review ? { last_review: prior.last_review } : {}),
      }
    : scheduler.initial(now)

  const next = scheduler.next(base, outcome, now)
  await sink.saveLineState(lineId, next, profileId)
  await sink.logReviewEvent({
    line_id: lineId,
    ts: now,
    outcome,
    retries_used_count: retriesUsed,
    rating: OUTCOME_RATING[outcome],
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    profile_id: profileId,
  })

  return {
    line_id: lineId,
    profile_id: profileId,
    stability: next.stability,
    difficulty: next.difficulty,
    due: next.due,
    state: next.state as LineSrsStateName,
    reps: next.reps,
    lapses: next.lapses,
    consecutive_correct: next.consecutive_correct,
    learning_steps: next.learning_steps ?? 0,
    last_review: next.last_review ?? null,
  }
}
