import { describe, it, expect } from 'vitest'
import { commitLineReview, type LineReviewSink } from '../LineReviewRecorder.ts'
import type { LogReviewEventInput, PersistedLineState } from '../Repository.ts'
import type { LineSrsState } from '../types.ts'

interface SavedCall {
  lineId: number
  state: LineSrsState
  profileId?: string
}

class FakeSink implements LineReviewSink {
  saved: SavedCall[] = []
  events: LogReviewEventInput[] = []

  async saveLineState(
    lineId: number,
    state: LineSrsState,
    profileId?: string,
  ): Promise<void> {
    this.saved.push({ lineId, state, profileId })
  }

  async logReviewEvent(input: LogReviewEventInput): Promise<void> {
    this.events.push(input)
  }
}

describe('commitLineReview', () => {
  it('first review (no prior) saves a state and logs a Good event for pass_all_first', async () => {
    const sink = new FakeSink()
    const now = new Date('2026-01-01T00:00:00Z')

    const saved = await commitLineReview({
      sink,
      lineId: 42,
      prior: null,
      outcome: 'pass_all_first',
      retriesUsed: 0,
      now,
    })

    expect(sink.saved).toHaveLength(1)
    expect(sink.saved[0].lineId).toBe(42)
    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]).toMatchObject({
      line_id: 42,
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
      ts: now,
    })
    // A first pass moves the line out of 'new' and starts a streak.
    expect(saved.state).not.toBe('new')
    expect(saved.consecutive_correct).toBe(1)
    expect(saved.line_id).toBe(42)
  })

  it('maps each outcome to its rating', async () => {
    const cases: Array<
      [Parameters<typeof commitLineReview>[0]['outcome'], string]
    > = [
      ['pass_all_first', 'Good'],
      ['pass_with_retry', 'Hard'],
      ['fail', 'Again'],
    ]
    for (const [outcome, rating] of cases) {
      const sink = new FakeSink()
      await commitLineReview({
        sink,
        lineId: 1,
        prior: null,
        outcome,
        retriesUsed: 1,
      })
      expect(sink.events[0].rating).toBe(rating)
    }
  })

  it('fail resets the consecutive_correct streak carried from a prior state', async () => {
    const sink = new FakeSink()
    const prior: PersistedLineState = {
      line_id: 7,
      profile_id: 'default',
      stability: 30,
      difficulty: 5,
      due: new Date('2026-01-01T00:00:00Z'),
      state: 'review',
      reps: 4,
      lapses: 0,
      consecutive_correct: 3,
      learning_steps: 0,
      last_review: new Date('2025-12-20T00:00:00Z'),
    }

    const saved = await commitLineReview({
      sink,
      lineId: 7,
      prior,
      outcome: 'fail',
      retriesUsed: 2,
    })

    expect(saved.consecutive_correct).toBe(0)
    expect(sink.events[0].rating).toBe('Again')
    // The returned state mirrors exactly what was saved.
    expect(sink.saved[0].state.consecutive_correct).toBe(0)
  })

  it('threads the prior learning_steps into scheduling so a learning line graduates', async () => {
    // Regression: the recorder rebuilt the scheduler input without
    // learning_steps, pinning every line at step 0 (+10 min loop forever).
    const sink = new FakeSink()
    const now = new Date('2026-01-01T00:10:00Z')
    const prior: PersistedLineState = {
      line_id: 7,
      profile_id: 'default',
      stability: 1,
      difficulty: 5,
      due: now,
      state: 'learning',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      learning_steps: 1,
      last_review: new Date('2026-01-01T00:00:00Z'),
    }

    const saved = await commitLineReview({
      sink,
      lineId: 7,
      prior,
      outcome: 'pass_all_first',
      retriesUsed: 0,
      now,
    })

    expect(saved.state).toBe('review')
    expect(saved.due.getTime() - now.getTime()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000,
    )
  })

  it('threads a non-default profileId through both writes', async () => {
    const sink = new FakeSink()
    await commitLineReview({
      sink,
      lineId: 9,
      prior: null,
      outcome: 'pass_all_first',
      retriesUsed: 0,
      profileId: 'alice',
    })
    expect(sink.saved[0].profileId).toBe('alice')
    expect(sink.events[0].profile_id).toBe('alice')
  })
})

describe('commitLineReview — duration', () => {
  it('passes the walk duration through to the review event', async () => {
    const sink = new FakeSink()

    await commitLineReview({
      sink,
      lineId: 7,
      prior: null,
      outcome: 'pass_all_first',
      retriesUsed: 0,
      now: new Date('2026-06-12T10:00:00Z'),
      durationMs: 12500,
    })

    expect(sink.events[0].duration_ms).toBe(12500)
  })

  it('omits duration when the caller did not time the walk', async () => {
    const sink = new FakeSink()

    await commitLineReview({
      sink,
      lineId: 7,
      prior: null,
      outcome: 'fail',
      retriesUsed: 1,
      now: new Date('2026-06-12T10:00:00Z'),
    })

    expect(sink.events[0].duration_ms).toBeUndefined()
  })
})
