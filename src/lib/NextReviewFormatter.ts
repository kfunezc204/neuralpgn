const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE

/**
 * Human text for "when does the next review unlock", shown where there is
 * nothing due right now (course card, global review button). Unlike
 * formatDueIn (completion panel), this speaks in prospective phrasing:
 * "en 25 min", "en 3 h", "mañana", "en 5 días".
 */
export function formatNextReview(due: Date, now: Date): string {
  const diff = due.getTime() - now.getTime()
  if (diff <= 0) return 'ahora'
  if (diff < MS_PER_HOUR) {
    return `en ${Math.max(1, Math.round(diff / MS_PER_MINUTE))} min`
  }
  const dayDelta = calendarDayDelta(due, now)
  if (dayDelta === 0) {
    return `en ${Math.round(diff / MS_PER_HOUR)} h`
  }
  if (dayDelta === 1) return 'mañana'
  return `en ${dayDelta} días`
}

/** Whole calendar days between the two local dates (due − now). */
function calendarDayDelta(due: Date, now: Date): number {
  const a = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a.getTime() - b.getTime()) / (24 * MS_PER_HOUR))
}
