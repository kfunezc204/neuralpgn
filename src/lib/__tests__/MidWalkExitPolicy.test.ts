import { describe, it, expect } from 'vitest'
import { decideMidWalkExit } from '../MidWalkExitPolicy.ts'

describe('MidWalkExitPolicy', () => {
  it('exits teach mode silently even when the user already advanced through several teach steps', () => {
    expect(
      decideMidWalkExit({ mode: 'teach', hasProgress: true }),
    ).toEqual({ kind: 'silent' })
  })

  it('exits refresher mode silently — refresher never affects SRS so there is nothing to warn about', () => {
    expect(
      decideMidWalkExit({ mode: 'refresher', hasProgress: true }),
    ).toEqual({ kind: 'silent' })
  })

  it('exits quiz mode silently when the user has not yet played a single step (no SRS impact at risk)', () => {
    expect(
      decideMidWalkExit({ mode: 'quiz', hasProgress: false }),
    ).toEqual({ kind: 'silent' })
  })

  it('warns when leaving a quiz that has at least one step played but is not yet completed', () => {
    expect(
      decideMidWalkExit({ mode: 'quiz', hasProgress: true }),
    ).toEqual({
      kind: 'warn',
      reason: 'quiz-in-progress',
    })
  })
})
