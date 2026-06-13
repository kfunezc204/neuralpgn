import { describe, it, expect } from 'vitest'
import { shouldPreselectChallenge } from '../ChallengeHeuristic.ts'

describe('ChallengeHeuristic', () => {
  it('preselects when every chapter is stm (mixed-side tactics pack)', () => {
    expect(
      shouldPreselectChallenge([{ user_side: 'stm' }, { user_side: 'stm' }]),
    ).toBe(true)
  })

  it('does not preselect when any chapter has a fixed side', () => {
    expect(
      shouldPreselectChallenge([{ user_side: 'stm' }, { user_side: 'white' }]),
    ).toBe(false)
    expect(shouldPreselectChallenge([{ user_side: 'black' }])).toBe(false)
  })

  it('does not preselect an empty preview', () => {
    expect(shouldPreselectChallenge([])).toBe(false)
  })
})
