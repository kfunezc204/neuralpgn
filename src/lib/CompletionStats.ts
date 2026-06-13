export interface AccuracyInput {
  totalQuizzed: number
  retriesUsed: number
}

export function computeAccuracyPercent(input: AccuracyInput): number {
  if (input.totalQuizzed <= 0) return 100
  const raw = (input.totalQuizzed - input.retriesUsed) / input.totalQuizzed
  const clamped = Math.max(0, Math.min(1, raw))
  return Math.round(clamped * 100)
}

const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Human-readable time until the next review, in the unit that matches the
 * scale: minutes for FSRS learning steps, hours/days once the line graduates.
 * Rounding a 10-minute step up to "1 día" is exactly the lie this replaces.
 */
export function formatDueIn(due: Date, now: Date): string {
  const diff = due.getTime() - now.getTime()
  if (diff <= 0) return 'ahora'
  if (diff < MS_PER_HOUR) {
    return `${Math.max(1, Math.round(diff / MS_PER_MINUTE))} min`
  }
  if (diff < MS_PER_DAY) {
    return `${Math.round(diff / MS_PER_HOUR)} h`
  }
  const days = Math.round(diff / MS_PER_DAY)
  return days === 1 ? '1 día' : `${days} días`
}

/** Solve time for a challenge exercise: "14s" under a minute, "1min 23s" above. */
export function formatSolveTime(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}min ${totalSeconds % 60}s`
}
