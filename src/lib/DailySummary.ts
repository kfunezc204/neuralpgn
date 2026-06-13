export interface ReviewActivityEvent {
  lineId: number
  ts: Date
  /** Timestamp of this line's first-ever review event (its "learned" moment). */
  firstEverTs: Date
}

export interface DailySummaryResult {
  /** Review events today on lines that were already learned before today. */
  reviewedToday: number
  /** Distinct lines whose first-ever review event happened today. */
  newToday: number
}

/**
 * Aggregate today's training activity from review history. "Today" starts at
 * local midnight of `now`; events may include older rows (callers typically
 * over-fetch), they are filtered here so the midnight cutoff stays testable.
 */
export function summarizeDay(
  events: ReviewActivityEvent[],
  now: Date,
): DailySummaryResult {
  const dayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()

  let reviewedToday = 0
  const newLineIds = new Set<number>()
  for (const e of events) {
    if (e.ts.getTime() < dayStart) continue
    if (e.firstEverTs.getTime() >= dayStart) {
      newLineIds.add(e.lineId)
    } else {
      reviewedToday++
    }
  }
  return { reviewedToday, newToday: newLineIds.size }
}
