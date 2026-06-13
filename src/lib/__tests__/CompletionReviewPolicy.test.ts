import { describe, it, expect } from 'vitest'
import {
  shouldOfferCompletionReview,
  stepCompletionReview,
} from '../CompletionReviewPolicy.ts'

describe('shouldOfferCompletionReview', () => {
  it('always offers review after teach, regardless of outcome', () => {
    expect(shouldOfferCompletionReview('teach', 'pass_all_first')).toBe(true)
    expect(shouldOfferCompletionReview('teach', 'pass_with_retry')).toBe(true)
    expect(shouldOfferCompletionReview('teach', 'fail')).toBe(true)
  })

  it('offers review after a quiz only when the outcome was Hard or Again', () => {
    expect(shouldOfferCompletionReview('quiz', 'pass_all_first')).toBe(false)
    expect(shouldOfferCompletionReview('quiz', 'pass_with_retry')).toBe(true)
    expect(shouldOfferCompletionReview('quiz', 'fail')).toBe(true)
  })

  it('always offers review after a refresher (study mode, like teach)', () => {
    expect(shouldOfferCompletionReview('refresher', 'pass_all_first')).toBe(
      true,
    )
  })

  it('never offers review for replay completions', () => {
    expect(shouldOfferCompletionReview('replay', 'fail')).toBe(false)
  })
})

describe('stepCompletionReview', () => {
  const TOTAL = 8

  it('rests at null (final position) and prev steps into the last move', () => {
    expect(stepCompletionReview(null, 'prev', TOTAL)).toBe(7)
  })

  it('next from the resting state stays at the final position', () => {
    expect(stepCompletionReview(null, 'next', TOTAL)).toBeNull()
  })

  it('next past the last step returns to the final position (reversible)', () => {
    expect(stepCompletionReview(7, 'next', TOTAL)).toBeNull()
    expect(stepCompletionReview(6, 'next', TOTAL)).toBe(7)
  })

  it('prev clamps at the first step', () => {
    expect(stepCompletionReview(0, 'prev', TOTAL)).toBe(0)
  })

  it('first jumps to step 0, last returns to the final position', () => {
    expect(stepCompletionReview(4, 'first', TOTAL)).toBe(0)
    expect(stepCompletionReview(null, 'first', TOTAL)).toBe(0)
    expect(stepCompletionReview(4, 'last', TOTAL)).toBeNull()
  })

  it('an empty line never leaves the final position', () => {
    expect(stepCompletionReview(null, 'first', 0)).toBeNull()
    expect(stepCompletionReview(null, 'prev', 0)).toBeNull()
  })
})
