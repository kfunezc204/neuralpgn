import { describe, it, expect } from 'vitest'
import {
  computeAccuracyPercent,
  formatDueIn,
  formatSolveTime,
} from '../CompletionStats.ts'

describe('CompletionStats.computeAccuracyPercent', () => {
  it('returns 100 when the user answered every quizzed step on the first try', () => {
    expect(computeAccuracyPercent({ totalQuizzed: 8, retriesUsed: 0 })).toBe(
      100,
    )
  })

  it('penalizes each retry against the total quizzed step count', () => {
    // 8 quizzed steps, 2 retries → (8-2)/8 = 0.75
    expect(computeAccuracyPercent({ totalQuizzed: 8, retriesUsed: 2 })).toBe(75)
  })

  it('floors at 0 when retries exceed the number of quizzed steps (defensive)', () => {
    expect(computeAccuracyPercent({ totalQuizzed: 4, retriesUsed: 10 })).toBe(0)
  })

  it('returns 100 (not NaN) when the line had no quizzed steps (fully autoplayed prefix)', () => {
    expect(computeAccuracyPercent({ totalQuizzed: 0, retriesUsed: 0 })).toBe(
      100,
    )
  })

  it('rounds to the nearest integer percent', () => {
    // 3/7 = 0.4285... → 43%
    expect(computeAccuracyPercent({ totalQuizzed: 7, retriesUsed: 4 })).toBe(43)
  })
})

describe('CompletionStats.formatDueIn', () => {
  const NOW = new Date('2026-05-19T12:00:00Z')

  it('returns "ahora" when the due date is in the past or exactly now', () => {
    expect(formatDueIn(new Date('2026-05-10T00:00:00Z'), NOW)).toBe('ahora')
    expect(formatDueIn(NOW, NOW)).toBe('ahora')
  })

  it('shows a 10-minute learning step as minutes, not as "1 día"', () => {
    expect(formatDueIn(new Date('2026-05-19T12:10:00Z'), NOW)).toBe('10 min')
  })

  it('floors sub-minute gaps at 1 min', () => {
    expect(formatDueIn(new Date('2026-05-19T12:00:20Z'), NOW)).toBe('1 min')
  })

  it('shows sub-day gaps in hours (8h ahead → "8 h")', () => {
    expect(formatDueIn(new Date('2026-05-19T20:00:00Z'), NOW)).toBe('8 h')
  })

  it('shows a full 24-hour gap as "1 día"', () => {
    expect(formatDueIn(new Date('2026-05-20T12:00:00Z'), NOW)).toBe('1 día')
  })

  it('shows ten days ahead as "10 días"', () => {
    expect(formatDueIn(new Date('2026-05-29T12:00:00Z'), NOW)).toBe('10 días')
  })
})

describe('formatSolveTime', () => {
  it('formats sub-minute times as seconds', () => {
    expect(formatSolveTime(14250)).toBe('14s')
    expect(formatSolveTime(900)).toBe('1s')
  })

  it('formats minute-scale times as m min s', () => {
    expect(formatSolveTime(83000)).toBe('1min 23s')
    expect(formatSolveTime(180000)).toBe('3min 0s')
  })
})
