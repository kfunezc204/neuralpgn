import { describe, it, expect } from 'vitest'
import { resolveTabMode } from '../TabModeResolver.ts'

const NOW = new Date('2025-06-01T00:00:00Z')

describe('TabModeResolver', () => {
  it('resolves tab=learn on a brand-new line to teach mode', () => {
    const result = resolveTabMode({
      tab: 'learn',
      lineState: null,
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'teach' })
  })

  it('resolves tab=learn on an already-learned line to refresher mode', () => {
    const result = resolveTabMode({
      tab: 'learn',
      lineState: {
        state: 'review',
        stability: 5,
        consecutive_correct: 1,
        due: new Date('2025-07-01T00:00:00Z'),
      },
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'refresher' })
  })

  it('resolves tab=review on a due learned line to quiz mode', () => {
    const result = resolveTabMode({
      tab: 'review',
      lineState: {
        state: 'review',
        stability: 5,
        consecutive_correct: 1,
        due: new Date('2025-05-01T00:00:00Z'), // past → due
      },
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'quiz' })
  })

  it('marks tab=review on a not-yet-due line as disabled (no mode)', () => {
    const result = resolveTabMode({
      tab: 'review',
      lineState: {
        state: 'review',
        stability: 5,
        consecutive_correct: 1,
        due: new Date('2025-07-01T00:00:00Z'), // future
      },
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'disabled', reason: 'not-due' })
  })

  it('marks tab=review on a still-new line as disabled (cannot review)', () => {
    const result = resolveTabMode({
      tab: 'review',
      lineState: null,
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'disabled', reason: 'not-due' })
  })

  it('overrides any tab/state combination to refresher when ?mode=refresh is in the URL', () => {
    const learnNew = resolveTabMode({
      tab: 'learn',
      lineState: null,
      modeOverride: 'refresh',
      now: NOW,
    })
    expect(learnNew).toEqual({ kind: 'allowed', mode: 'refresher' })

    const reviewNotDue = resolveTabMode({
      tab: 'review',
      lineState: {
        state: 'review',
        stability: 5,
        consecutive_correct: 1,
        due: new Date('2025-07-01T00:00:00Z'),
      },
      modeOverride: 'refresh',
      now: NOW,
    })
    expect(reviewNotDue).toEqual({ kind: 'allowed', mode: 'refresher' })
  })

  it('defaults to the learn tab when tab is missing from the URL', () => {
    const result = resolveTabMode({
      tab: null,
      lineState: null,
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'teach' })
  })

  it('archived line on tab=learn resolves to replay mode', () => {
    const result = resolveTabMode({
      tab: 'learn',
      isArchived: true,
      lineState: null,
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'replay' })
  })

  it('archived line on tab=review resolves to replay mode (even with no lineState)', () => {
    const result = resolveTabMode({
      tab: 'review',
      isArchived: true,
      lineState: null,
      modeOverride: null,
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'replay' })
  })

  it('archived line beats modeOverride=refresh (replay wins)', () => {
    const result = resolveTabMode({
      tab: 'learn',
      isArchived: true,
      lineState: null,
      modeOverride: 'refresh',
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'replay' })
  })

  it('modeOverride=archive on a non-archived line is ignored (falls back to tab)', () => {
    const result = resolveTabMode({
      tab: 'learn',
      isArchived: false,
      lineState: null,
      modeOverride: 'archive',
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'teach' })
  })

  it('modeOverride=archive on a non-archived review-due line falls back to quiz', () => {
    const result = resolveTabMode({
      tab: 'review',
      isArchived: false,
      lineState: {
        state: 'review',
        stability: 5,
        consecutive_correct: 1,
        due: new Date('2025-05-01T00:00:00Z'),
      },
      modeOverride: 'archive',
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'quiz' })
  })

  it('modeOverride=archive on an archived line resolves to replay (redundant but documented)', () => {
    const result = resolveTabMode({
      tab: 'review',
      isArchived: true,
      lineState: null,
      modeOverride: 'archive',
      now: NOW,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'replay' })
  })
})

describe('TabModeResolver — challenge courses', () => {
  it('resolves tab=learn on a new line in a challenge course to quiz (no teach)', () => {
    const result = resolveTabMode({
      tab: 'learn',
      lineState: null,
      modeOverride: null,
      now: NOW,
      isChallenge: true,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'quiz' })
  })
})

describe('TabModeResolver — challenge matrix', () => {
  const learnedState = {
    state: 'review' as const,
    stability: 5,
    consecutive_correct: 1,
    due: new Date('2025-05-01T00:00:00Z'),
  }

  it('a new line in a non-challenge course still teaches (no regression)', () => {
    const result = resolveTabMode({
      tab: 'learn',
      lineState: null,
      modeOverride: null,
      now: NOW,
      isChallenge: false,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'teach' })
  })

  it('an already-learned line in a challenge course refreshes on learn tab like today', () => {
    const result = resolveTabMode({
      tab: 'learn',
      lineState: learnedState,
      modeOverride: null,
      now: NOW,
      isChallenge: true,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'refresher' })
  })

  it('review tab is indifferent to the challenge flag (due line quizzes either way)', () => {
    const result = resolveTabMode({
      tab: 'review',
      lineState: learnedState,
      modeOverride: null,
      now: NOW,
      isChallenge: true,
    })
    expect(result).toEqual({ kind: 'allowed', mode: 'quiz' })
  })

  it('refresh override and archived lines beat the challenge flag', () => {
    expect(
      resolveTabMode({
        tab: 'learn',
        lineState: null,
        modeOverride: 'refresh',
        now: NOW,
        isChallenge: true,
      }),
    ).toEqual({ kind: 'allowed', mode: 'refresher' })
    expect(
      resolveTabMode({
        tab: 'learn',
        lineState: null,
        modeOverride: null,
        now: NOW,
        isArchived: true,
        isChallenge: true,
      }),
    ).toEqual({ kind: 'allowed', mode: 'replay' })
  })
})
