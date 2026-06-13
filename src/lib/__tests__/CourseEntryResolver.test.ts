import { describe, it, expect } from 'vitest'
import { resolveCourseEntry } from '../CourseEntryResolver.ts'

const learn = { line_id: 11 }
const due = { line_id: 22 }
const first = { line_id: 33 }

describe('CourseEntryResolver', () => {
  it('redirects ?tab=learn to the next learn line and preserves the learn tab', () => {
    const r = resolveCourseEntry({
      tab: 'learn',
      nextLearn: learn,
      nextDue: due,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 11, query: '?tab=learn' })
  })

  it('falls through to the smart auto-pick when ?tab=learn has no remaining new line', () => {
    const r = resolveCourseEntry({
      tab: 'learn',
      nextLearn: null,
      nextDue: due,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 22, query: '?tab=review' })
  })

  it('redirects ?tab=review to the first due line and preserves the review tab', () => {
    const r = resolveCourseEntry({
      tab: 'review',
      nextLearn: learn,
      nextDue: due,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 22, query: '?tab=review' })
  })

  it('falls through to learn auto-pick when ?tab=review has no due line', () => {
    const r = resolveCourseEntry({
      tab: 'review',
      nextLearn: learn,
      nextDue: null,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 11, query: '?tab=learn' })
  })

  it('bare entry prefers a new line and opens it under the learn tab', () => {
    const r = resolveCourseEntry({
      tab: null,
      nextLearn: learn,
      nextDue: due,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 11, query: '?tab=learn' })
  })

  it('bare entry without new lines falls back to a due line under the review tab', () => {
    const r = resolveCourseEntry({
      tab: null,
      nextLearn: null,
      nextDue: due,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 22, query: '?tab=review' })
  })

  it('bare entry with no new and no due lines opens the first line in refresher mode', () => {
    const r = resolveCourseEntry({
      tab: null,
      nextLearn: null,
      nextDue: null,
      firstLine: first,
    })
    expect(r).toEqual({ lineId: 33, query: '?mode=refresh' })
  })

  it('returns null when the PGN has no playable line at all', () => {
    const r = resolveCourseEntry({
      tab: null,
      nextLearn: null,
      nextDue: null,
      firstLine: null,
    })
    expect(r).toBeNull()
  })
})
