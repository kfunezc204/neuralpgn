import { describe, it, expect } from 'vitest'
import { summarizeDay } from '../DailySummary.ts'
import type { ReviewActivityEvent } from '../DailySummary.ts'

const NOW = new Date('2026-06-11T14:00:00')

function ev(
  lineId: number,
  ts: string,
  firstEverTs: string,
): ReviewActivityEvent {
  return { lineId, ts: new Date(ts), firstEverTs: new Date(firstEverTs) }
}

describe('DailySummary', () => {
  it('reports zero activity for a day with no events', () => {
    expect(summarizeDay([], NOW)).toEqual({ reviewedToday: 0, newToday: 0 })
  })

  it('counts lines first reviewed today as new, not as reviews', () => {
    const events = [
      ev(1, '2026-06-11T09:00:00', '2026-06-11T09:00:00'),
      ev(2, '2026-06-11T09:05:00', '2026-06-11T09:05:00'),
    ]
    expect(summarizeDay(events, NOW)).toEqual({
      reviewedToday: 0,
      newToday: 2,
    })
  })

  it("counts today's events on previously learned lines as reviews", () => {
    const events = [
      ev(1, '2026-06-11T09:00:00', '2026-06-01T10:00:00'),
      ev(1, '2026-06-11T13:00:00', '2026-06-01T10:00:00'),
      ev(2, '2026-06-11T09:30:00', '2026-05-20T10:00:00'),
    ]
    expect(summarizeDay(events, NOW)).toEqual({
      reviewedToday: 3,
      newToday: 0,
    })
  })

  it('ignores events from before local midnight (yesterday is not today)', () => {
    const events = [
      // Yesterday late night — outside the window even though < 24h ago.
      ev(1, '2026-06-10T23:50:00', '2026-06-01T10:00:00'),
      // Today early morning — inside.
      ev(2, '2026-06-11T00:10:00', '2026-06-01T10:00:00'),
    ]
    expect(summarizeDay(events, NOW)).toEqual({
      reviewedToday: 1,
      newToday: 0,
    })
  })

  it('a line learned today and re-quizzed today counts once as new, not as a review', () => {
    const events = [
      ev(7, '2026-06-11T09:00:00', '2026-06-11T09:00:00'),
      ev(7, '2026-06-11T12:00:00', '2026-06-11T09:00:00'),
    ]
    expect(summarizeDay(events, NOW)).toEqual({
      reviewedToday: 0,
      newToday: 1,
    })
  })
})
