import { describe, it, expect } from 'vitest'
import { buildRepertoireIndex, loadCourseSources } from '../RepertoireIndex.ts'
import type { CourseSource } from '../RepertoireIndex.ts'

const INITIAL_CANON = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
// After 1. e4 e5
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'

function whiteCourse(): CourseSource {
  return {
    pgn_id: 1,
    pgn_name: 'Italian Repertoire',
    chapters: [{ id: 10, user_side: 'white' }],
    cards: [
      { id: 100, chapter_id: 10, fen_canonical: INITIAL_CANON },
      { id: 101, chapter_id: 10, fen_canonical: AFTER_E4_E5 },
    ],
    lines: [
      {
        id: 1000,
        chapter_id: 10,
        dfs_index: 0,
        steps: [
          { card_id: 100, expected_san: 'e4' },
          { card_id: 101, expected_san: 'Bc4' },
        ],
      },
    ],
  }
}

describe('RepertoireIndex', () => {
  it('finds the expected move at a known position for the matching color', () => {
    const index = buildRepertoireIndex([whiteCourse()])

    // Full 6-field FEN in, canonical matching inside.
    const entry = index.lookup(
      'white',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    )

    expect(entry).not.toBeNull()
    expect(entry!.moves).toHaveLength(1)
    expect(entry!.moves[0]).toMatchObject({
      san: 'Bc4',
      card_id: 101,
      chapter_id: 10,
      pgn_id: 1,
      pgn_name: 'Italian Repertoire',
      line_id: 1000,
    })
  })

  it('returns null for the wrong color even when the position exists', () => {
    const index = buildRepertoireIndex([whiteCourse()])
    expect(index.lookup('black', AFTER_E4_E5)).toBeNull()
  })

  it('excludes stm chapters entirely', () => {
    const course = whiteCourse()
    course.chapters[0].user_side = 'stm'
    const index = buildRepertoireIndex([course])

    expect(index.lookup('white', AFTER_E4_E5)).toBeNull()
    expect(index.lookup('black', AFTER_E4_E5)).toBeNull()
    expect(index.isEmpty('white')).toBe(true)
  })

  it('merges sibling lines at the same position and attributes each san to its lowest-dfs line', () => {
    const course = whiteCourse()
    // Sibling line through the same cards: same e4, but 2. Nf3 instead of Bc4.
    course.lines.push({
      id: 1001,
      chapter_id: 10,
      dfs_index: 1,
      steps: [
        { card_id: 100, expected_san: 'e4' },
        { card_id: 101, expected_san: 'Nf3' },
      ],
    })
    // A later line repeating Bc4 must NOT steal the attribution from line 1000.
    course.lines.push({
      id: 1002,
      chapter_id: 10,
      dfs_index: 2,
      steps: [
        { card_id: 100, expected_san: 'e4' },
        { card_id: 101, expected_san: 'Bc4' },
      ],
    })
    const index = buildRepertoireIndex([course])

    const entry = index.lookup('white', AFTER_E4_E5)!
    expect(entry.moves.map((m) => m.san).sort()).toEqual(['Bc4', 'Nf3'])
    expect(entry.moves.find((m) => m.san === 'Bc4')!.line_id).toBe(1000)
    expect(entry.moves.find((m) => m.san === 'Nf3')!.line_id).toBe(1001)
  })

  it('merges positions shared across courses without duplicating sans', () => {
    const second: CourseSource = {
      pgn_id: 2,
      pgn_name: 'Other Course',
      chapters: [{ id: 20, user_side: 'white' }],
      cards: [{ id: 200, chapter_id: 20, fen_canonical: AFTER_E4_E5 }],
      lines: [
        {
          id: 2000,
          chapter_id: 20,
          dfs_index: 0,
          steps: [{ card_id: 200, expected_san: 'Bc4' }],
        },
      ],
    }
    const index = buildRepertoireIndex([whiteCourse(), second])

    const entry = index.lookup('white', AFTER_E4_E5)!
    // Same san from two courses: the first course in order keeps the attribution.
    expect(entry.moves).toHaveLength(1)
    expect(entry.moves[0].pgn_name).toBe('Italian Repertoire')
  })

  it('loads course sources through the repository reader interface', async () => {
    const course = whiteCourse()
    const fakeRepo = {
      listPgns: async () => [
        { id: 1, name: 'Italian Repertoire', is_challenge: false },
      ],
      getChaptersForPgn: async (id: number) =>
        id === 1 ? course.chapters : [],
      getCardsForChapter: async (id: number) =>
        course.cards.filter((c) => c.chapter_id === id),
      getLinesForPgn: async (id: number) => (id === 1 ? course.lines : []),
    }

    const sources = await loadCourseSources(fakeRepo)
    const index = buildRepertoireIndex(sources)

    expect(index.lookup('white', AFTER_E4_E5)!.moves[0].san).toBe('Bc4')
  })

  it('excludes challenge courses (tactics packs) — they are not repertoire', async () => {
    const course = whiteCourse()
    const fakeRepo = {
      listPgns: async () => [
        { id: 1, name: 'Tactics Pack', is_challenge: true },
      ],
      getChaptersForPgn: async () => course.chapters,
      getCardsForChapter: async () => course.cards,
      getLinesForPgn: async () => course.lines,
    }

    const sources = await loadCourseSources(fakeRepo)
    const index = buildRepertoireIndex(sources)

    expect(sources).toEqual([])
    expect(index.lookup('white', AFTER_E4_E5)).toBeNull()
  })
})
