import { describe, it, expect } from 'vitest'
import { lineSidebarState } from '../LineSidebarState.ts'

const NOW = new Date('2025-06-01T00:00:00Z')

describe('LineSidebarState', () => {
  it('classifies a line with no SRS state row as new and not due', () => {
    const result = lineSidebarState(null, NOW)
    expect(result).toEqual({ status: 'new', isDue: false })
  })

  it('classifies a review-state line that meets D10 (stability >= 21d AND consecutive_correct >= 3) as mastered', () => {
    const result = lineSidebarState(
      {
        state: 'review',
        stability: 21,
        consecutive_correct: 3,
        due: new Date('2025-07-01T00:00:00Z'),
      },
      NOW,
    )
    expect(result.status).toBe('mastered')
  })

  it('does not promote to mastered when stability is high but consecutive_correct < 3 (D10 is an AND, not OR)', () => {
    const result = lineSidebarState(
      {
        state: 'review',
        stability: 50, // well above 21d
        consecutive_correct: 2, // below threshold
        due: new Date('2025-07-01T00:00:00Z'),
      },
      NOW,
    )
    expect(result.status).toBe('learning')
  })

  it('marks isDue true when the line has been learned (state != new) and due is at or before now, false otherwise', () => {
    const learningDuePast = lineSidebarState(
      {
        state: 'learning',
        stability: 1,
        consecutive_correct: 1,
        due: new Date('2025-05-01T00:00:00Z'),
      },
      NOW,
    )
    expect(learningDuePast.isDue).toBe(true)

    const learningDueFuture = lineSidebarState(
      {
        state: 'learning',
        stability: 1,
        consecutive_correct: 1,
        due: new Date('2025-07-01T00:00:00Z'),
      },
      NOW,
    )
    expect(learningDueFuture.isDue).toBe(false)
  })
})
