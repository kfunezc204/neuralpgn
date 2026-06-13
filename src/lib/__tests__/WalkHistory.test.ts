import { describe, it, expect } from 'vitest'
import { recordHistory, emptyHistory } from '../WalkHistory.ts'

describe('WalkHistory.recordHistory', () => {
  it('starts as an empty list', () => {
    expect(emptyHistory()).toEqual([])
  })

  it('appends a correct entry with the resolved SAN and post-resolve comment', () => {
    const next = recordHistory(emptyHistory(), {
      kind: 'correct',
      san: 'e4',
      comment: 'Opens the center.',
    })
    expect(next).toEqual([
      { kind: 'correct', san: 'e4', comment: 'Opens the center.' },
    ])
  })

  it('appends a wrong entry that captures both expected and played SANs', () => {
    const next = recordHistory(emptyHistory(), {
      kind: 'wrong',
      expected: 'Nf3',
      played: 'Nc3',
      comment: 'The knight belongs on f3 to defend e5 ideas.',
    })
    expect(next).toEqual([
      {
        kind: 'wrong',
        expected: 'Nf3',
        played: 'Nc3',
        comment: 'The knight belongs on f3 to defend e5 ideas.',
      },
    ])
  })

  it('appends an autoplay entry (no user input — needed in refresher + dominated prefix)', () => {
    const next = recordHistory(emptyHistory(), { kind: 'auto', san: 'd4' })
    expect(next).toEqual([{ kind: 'auto', san: 'd4' }])
  })

  it('appends a refutation entry with continuation moves and an optional comment', () => {
    const next = recordHistory(emptyHistory(), {
      kind: 'refutation',
      played: 'Nf3??',
      continuation: ['Nxe4', 'd3'],
      comment: 'Black wins a pawn.',
    })
    expect(next).toEqual([
      {
        kind: 'refutation',
        played: 'Nf3??',
        continuation: ['Nxe4', 'd3'],
        comment: 'Black wins a pawn.',
      },
    ])
  })

  it('returns a brand-new array on each append — never mutates the input (so React state updates are safe)', () => {
    const initial = emptyHistory()
    const next = recordHistory(initial, { kind: 'auto', san: 'e4' })
    expect(initial).toEqual([])
    expect(next).not.toBe(initial)
  })

  it('appends a replay entry (full move list pre-populated in archive replay)', () => {
    const next = recordHistory(emptyHistory(), {
      kind: 'replay',
      san: 'Nf3',
      comment: 'Develops the knight.',
    })
    expect(next).toEqual([
      { kind: 'replay', san: 'Nf3', comment: 'Develops the knight.' },
    ])
  })

  it('preserves insertion order across multiple appends', () => {
    let history = emptyHistory()
    history = recordHistory(history, { kind: 'correct', san: 'e4' })
    history = recordHistory(history, { kind: 'correct', san: 'e5' })
    history = recordHistory(history, { kind: 'correct', san: 'Nf3' })
    expect(history.map((h) => (h.kind === 'correct' ? h.san : null))).toEqual([
      'e4',
      'e5',
      'Nf3',
    ])
  })
})
