import { describe, it, expect } from 'vitest'
import { LineScheduler } from '../LineScheduler.ts'

describe('LineScheduler — initial state', () => {
  it('returns a new LineSrsState with stability 0, consecutive_correct 0, lapses 0', () => {
    const state = new LineScheduler().initial()

    expect(state.state).toBe('new')
    expect(state.stability).toBe(0)
    expect(state.difficulty).toBe(0)
    expect(state.consecutive_correct).toBe(0)
    expect(state.reps).toBe(0)
    expect(state.lapses).toBe(0)
    expect(state.due).toBeInstanceOf(Date)
  })
})

describe('LineScheduler — pass_all_first sequence', () => {
  it('after 3× pass_all_first, stability rises monotonically and consecutive_correct counts up', () => {
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')

    let state = sched.initial(t0)
    const stabilities: number[] = []
    const consec: number[] = []

    for (let i = 1; i <= 3; i++) {
      // Advance virtual time so FSRS sees elapsed days.
      const now = new Date(t0.getTime() + i * 24 * 60 * 60 * 1000 * 3)
      state = sched.next(state, 'pass_all_first', now)
      stabilities.push(state.stability)
      consec.push(state.consecutive_correct)
    }

    expect(consec).toEqual([1, 2, 3])
    expect(stabilities[0]).toBeGreaterThan(0)
    expect(stabilities[1]).toBeGreaterThan(stabilities[0])
    expect(stabilities[2]).toBeGreaterThan(stabilities[1])
    expect(state.lapses).toBe(0)
  })
})

describe('LineScheduler — learning-step graduation', () => {
  const MINUTE = 60_000

  it('first pass_all_first schedules the short learning step (~10 min), not days', () => {
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')

    const state = sched.next(sched.initial(t0), 'pass_all_first', t0)

    expect(state.state).toBe('learning')
    expect(state.learning_steps).toBe(1)
    const dueInMin = (state.due.getTime() - t0.getTime()) / MINUTE
    expect(dueInMin).toBeGreaterThan(0)
    expect(dueInMin).toBeLessThanOrEqual(15)
  })

  it('second consecutive pass_all_first graduates the line to review with a day-scale due', () => {
    // Regression: the step index used to be dropped on persistence (always
    // rebuilt as 0), so a 'learning' line re-scheduled +10 min forever and
    // never graduated. The state returned by next() round-trips the index the
    // same way the DB does.
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')

    let state = sched.next(sched.initial(t0), 'pass_all_first', t0)
    const t1 = new Date(t0.getTime() + 10 * MINUTE)
    state = sched.next(state, 'pass_all_first', t1)

    expect(state.state).toBe('review')
    const dueInDays = (state.due.getTime() - t1.getTime()) / 86400_000
    expect(dueInDays).toBeGreaterThanOrEqual(1)
  })

  it('a persisted state without learning_steps (pre-column data) is treated as step 0', () => {
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')

    const fresh = sched.next(sched.initial(t0), 'pass_all_first', t0)
    // Strip the field, as a row written before the migration would load.
    const { learning_steps: _ls, ...legacy } = fresh
    const state = sched.next(
      legacy,
      'pass_all_first',
      new Date(t0.getTime() + 10 * MINUTE),
    )

    expect(state.state).toBe('learning')
    expect(state.learning_steps).toBe(1)
  })
})

describe('LineScheduler — fail resets streak and drops stability', () => {
  it('fail after a streak of pass_all_first resets consecutive_correct to 0 and drops stability', () => {
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')

    let state = sched.initial(t0)
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 3 * 86400_000),
    )
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 6 * 86400_000),
    )
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 9 * 86400_000),
    )

    expect(state.consecutive_correct).toBe(3)
    const stabilityBefore = state.stability

    state = sched.next(state, 'fail', new Date(t0.getTime() + 12 * 86400_000))

    expect(state.consecutive_correct).toBe(0)
    expect(state.stability).toBeLessThan(stabilityBefore)
  })
})
