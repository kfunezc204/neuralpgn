import { describe, it, expect } from 'vitest'
import { formatNextReview } from '../NextReviewFormatter.ts'

const NOW = new Date('2026-06-11T10:00:00')

describe('NextReviewFormatter', () => {
  it('formats a due under an hour away in minutes', () => {
    const due = new Date('2026-06-11T10:25:00')
    expect(formatNextReview(due, NOW)).toBe('in 25 min')
  })

  it('formats a due later the same day in hours', () => {
    const due = new Date('2026-06-11T15:30:00')
    expect(formatNextReview(due, NOW)).toBe('in 6 h')
  })

  it('says "tomorrow" for a due on the next calendar day', () => {
    const due = new Date('2026-06-12T09:00:00')
    expect(formatNextReview(due, NOW)).toBe('tomorrow')
  })

  it('formats far dues in calendar days', () => {
    const due = new Date('2026-06-16T22:00:00')
    expect(formatNextReview(due, NOW)).toBe('in 5 days')
  })

  it('says "now" for a due already in the past', () => {
    const due = new Date('2026-06-11T09:00:00')
    expect(formatNextReview(due, NOW)).toBe('now')
  })
})
