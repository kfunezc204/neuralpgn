import { describe, it, expect } from 'vitest'
import { SessionSelector } from '../SessionSelector.ts'
import type { LineSrsStateName } from '../types.ts'

interface LineLike {
  id: string
  dfs_index: number
  state: LineSrsStateName
}

describe('SessionSelector — pickNextLessonToLearn', () => {
  const sel = new SessionSelector()

  it('returns the new line with the smallest dfs_index when multiple are new', () => {
    const lines: LineLike[] = [
      { id: 'L3', dfs_index: 3, state: 'new' },
      { id: 'L1', dfs_index: 1, state: 'new' },
      { id: 'L0', dfs_index: 0, state: 'learning' },
      { id: 'L2', dfs_index: 2, state: 'new' },
    ]

    const next = sel.pickNextLessonToLearn(lines)
    expect(next).not.toBeNull()
    expect(next!.id).toBe('L1')
    expect(next!.dfs_index).toBe(1)
  })

  it('skips non-new lines even if their dfs_index is lower', () => {
    const lines: LineLike[] = [
      { id: 'L0', dfs_index: 0, state: 'review' },
      { id: 'L1', dfs_index: 1, state: 'relearning' },
      { id: 'L2', dfs_index: 2, state: 'new' },
    ]

    const next = sel.pickNextLessonToLearn(lines)
    expect(next!.id).toBe('L2')
  })

  it('returns null when no line is in state new', () => {
    const lines: LineLike[] = [
      { id: 'L0', dfs_index: 0, state: 'learning' },
      { id: 'L1', dfs_index: 1, state: 'review' },
    ]

    expect(sel.pickNextLessonToLearn(lines)).toBeNull()
  })

  it('returns null for an empty input list', () => {
    expect(sel.pickNextLessonToLearn([])).toBeNull()
  })
})

describe('SessionSelector — pickInterleavedGlobalLines', () => {
  const sel = new SessionSelector()

  it('round-robin interleaves due lines from 3 chapters preserving in-chapter order (A:4 B:2 C:1 → ABCABAA)', () => {
    const refs = [
      { line_id: 101, chapter_id: 1 }, // A1
      { line_id: 102, chapter_id: 1 }, // A2
      { line_id: 103, chapter_id: 1 }, // A3
      { line_id: 104, chapter_id: 1 }, // A4
      { line_id: 201, chapter_id: 2 }, // B1
      { line_id: 202, chapter_id: 2 }, // B2
      { line_id: 301, chapter_id: 3 }, // C1
    ]

    const out = sel.pickInterleavedGlobalLines(refs)
    expect(out.map((r) => r.line_id)).toEqual([
      101, // A1
      201, // B1
      301, // C1
      102, // A2
      202, // B2
      103, // A3
      104, // A4
    ])
  })

  it('returns an empty array for an empty input', () => {
    expect(sel.pickInterleavedGlobalLines([])).toEqual([])
  })

  it('keeps a single-chapter input in its original order', () => {
    const refs = [
      { line_id: 10, chapter_id: 1 },
      { line_id: 20, chapter_id: 1 },
      { line_id: 30, chapter_id: 1 },
    ]
    expect(sel.pickInterleavedGlobalLines(refs).map((r) => r.line_id)).toEqual([
      10, 20, 30,
    ])
  })
})
