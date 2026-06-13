import { describe, it, expect } from 'vitest'
import {
  MASTERY_CONSECUTIVE_CORRECT,
  MASTERY_STABILITY_DAYS,
  MasteryEvaluator,
  masteryPredicateSql,
} from '../MasteryEvaluator.ts'

describe('MasteryEvaluator', () => {
  const m = new MasteryEvaluator()

  it('tracer: classifies stability=21 + consecutive_correct=3 as mastered', () => {
    expect(m.isMastered({ stability: 21, consecutive_correct: 3 })).toBe(true)
  })

  it('stability=20.99 just under threshold is NOT mastered', () => {
    expect(m.isMastered({ stability: 20.99, consecutive_correct: 3 })).toBe(
      false,
    )
  })

  it('stability=21.01 just over threshold IS mastered', () => {
    expect(m.isMastered({ stability: 21.01, consecutive_correct: 3 })).toBe(
      true,
    )
  })

  it('consecutive_correct=2 is NOT mastered regardless of high stability', () => {
    expect(m.isMastered({ stability: 100, consecutive_correct: 2 })).toBe(false)
  })

  it('consecutive_correct=3 with low stability is NOT mastered', () => {
    expect(m.isMastered({ stability: 5, consecutive_correct: 3 })).toBe(false)
  })

  it('higher streak and higher stability still mastered', () => {
    expect(m.isMastered({ stability: 60, consecutive_correct: 5 })).toBe(true)
  })
})

describe('masteryPredicateSql', () => {
  it('encodes the same thresholds as the constants, with the given alias', () => {
    expect(masteryPredicateSql('ls')).toBe(
      `(ls.stability >= ${MASTERY_STABILITY_DAYS} ` +
        `AND ls.consecutive_correct >= ${MASTERY_CONSECUTIVE_CORRECT})`,
    )
  })

  it('defaults the alias to ls', () => {
    expect(masteryPredicateSql()).toBe(masteryPredicateSql('ls'))
  })

  it('agrees with isMastered at the exact threshold boundary', () => {
    // The SQL fragment must classify the boundary point the same way isMastered
    // does (>= on both factors). This guards the two encodings against drift.
    const evaluator = new MasteryEvaluator()
    expect(
      evaluator.isMastered({
        stability: MASTERY_STABILITY_DAYS,
        consecutive_correct: MASTERY_CONSECUTIVE_CORRECT,
      }),
    ).toBe(true)
    expect(masteryPredicateSql('ls')).toContain(`>= ${MASTERY_STABILITY_DAYS}`)
    expect(masteryPredicateSql('ls')).toContain(
      `>= ${MASTERY_CONSECUTIVE_CORRECT}`,
    )
  })
})
