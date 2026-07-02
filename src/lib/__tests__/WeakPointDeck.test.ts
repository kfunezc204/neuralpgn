import { describe, it, expect } from 'vitest'
import {
  buildWeakPoints,
  ENTRY_THRESHOLD,
  GRADUATION_STREAK,
} from '../WeakPointDeck.ts'
import type { WeakPointAttempt, WeakPointMiss } from '../WeakPointDeck.ts'

function miss(
  card_id: number,
  ts: string,
  kind: WeakPointMiss['kind'] = 'double_fail',
  line_id = 10,
): WeakPointMiss {
  return { card_id, line_id, ts: new Date(ts), kind }
}

function attempt(
  card_id: number,
  ts: string,
  correct: boolean,
): WeakPointAttempt {
  return { card_id, ts: new Date(ts), correct }
}

describe('buildWeakPoints — entry threshold', () => {
  it('returns nothing for no data', () => {
    expect(buildWeakPoints([], [])).toEqual([])
  })

  it('a single recovered retry (score 1) stays below the threshold', () => {
    const out = buildWeakPoints([miss(1, '2026-01-01', 'retry')], [])
    expect(out).toEqual([])
  })

  it('two retries on the same card reach the threshold', () => {
    const out = buildWeakPoints(
      [miss(1, '2026-01-01', 'retry'), miss(1, '2026-01-02', 'retry')],
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0].card_id).toBe(1)
    expect(out[0].score).toBe(ENTRY_THRESHOLD)
  })

  it('one double-fail or one refutation enters immediately (weight 2)', () => {
    expect(
      buildWeakPoints([miss(1, '2026-01-01', 'double_fail')], []),
    ).toHaveLength(1)
    expect(
      buildWeakPoints([miss(2, '2026-01-01', 'refutation')], []),
    ).toHaveLength(1)
  })

  it('a failed puzzle attempt adds 1 to the score', () => {
    const out = buildWeakPoints(
      [miss(1, '2026-01-01', 'retry')],
      [attempt(1, '2026-01-02', false)],
    )
    expect(out).toHaveLength(1)
    expect(out[0].score).toBe(2)
  })

  it('misses on different cards do not pool', () => {
    const out = buildWeakPoints(
      [miss(1, '2026-01-01', 'retry'), miss(2, '2026-01-02', 'retry')],
      [],
    )
    expect(out).toEqual([])
  })
})

describe('buildWeakPoints — graduation streak', () => {
  const entered = [miss(1, '2026-01-01', 'double_fail')]

  it('graduates after GRADUATION_STREAK consecutive correct solves', () => {
    const passes = Array.from({ length: GRADUATION_STREAK }, (_, i) =>
      attempt(1, `2026-01-0${i + 2}`, true),
    )
    expect(buildWeakPoints(entered, passes)).toEqual([])
  })

  it('stays in the deck one solve short of graduation', () => {
    const out = buildWeakPoints(entered, [
      attempt(1, '2026-01-02', true),
      attempt(1, '2026-01-03', true),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].streak).toBe(2)
  })

  it('a failed puzzle attempt resets the streak and bumps the score', () => {
    const out = buildWeakPoints(entered, [
      attempt(1, '2026-01-02', true),
      attempt(1, '2026-01-03', true),
      attempt(1, '2026-01-04', false),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].streak).toBe(0)
    expect(out[0].score).toBe(3)
  })

  it('a new quiz miss after graduation re-enters the card', () => {
    const out = buildWeakPoints(
      [...entered, miss(1, '2026-01-10', 'double_fail')],
      [
        attempt(1, '2026-01-02', true),
        attempt(1, '2026-01-03', true),
        attempt(1, '2026-01-04', true),
      ],
    )
    expect(out).toHaveLength(1)
    expect(out[0].streak).toBe(0)
  })

  it('a same-instant miss sorts after the attempt and breaks the streak', () => {
    const out = buildWeakPoints(
      [...entered, miss(1, '2026-01-04', 'retry')],
      [
        attempt(1, '2026-01-02', true),
        attempt(1, '2026-01-03', true),
        attempt(1, '2026-01-04', true),
      ],
    )
    expect(out).toHaveLength(1)
    expect(out[0].streak).toBe(0)
  })
})

describe('buildWeakPoints — output shape', () => {
  it('orders by score desc, then most recent activity', () => {
    const out = buildWeakPoints(
      [
        miss(1, '2026-01-01', 'double_fail'),
        miss(2, '2026-01-02', 'double_fail'),
        miss(2, '2026-01-03', 'double_fail'),
        miss(3, '2026-01-05', 'double_fail'),
      ],
      [],
    )
    expect(out.map((w) => w.card_id)).toEqual([2, 3, 1])
  })

  it('collects miss line_ids most recent first, deduped', () => {
    const out = buildWeakPoints(
      [
        miss(1, '2026-01-01', 'retry', 10),
        miss(1, '2026-01-02', 'retry', 11),
        miss(1, '2026-01-03', 'retry', 10),
      ],
      [],
    )
    expect(out[0].line_ids).toEqual([10, 11])
  })

  it('puzzle attempts alone never create a deck entry line (no line_ids source)', () => {
    const out = buildWeakPoints(
      [],
      [attempt(1, '2026-01-01', false), attempt(1, '2026-01-02', false)],
    )
    expect(out).toHaveLength(1)
    expect(out[0].line_ids).toEqual([])
  })
})
