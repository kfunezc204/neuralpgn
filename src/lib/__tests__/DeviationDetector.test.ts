import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { analyzeGame } from '../DeviationDetector.ts'
import { buildRepertoireIndex } from '../RepertoireIndex.ts'
import type { CourseSource } from '../RepertoireIndex.ts'
import type { PersistedLineStep } from '../Repository.ts'

/** Canonical FEN reached from the initial position — matches how course cards are stored. */
function canonAfter(sans: string[]): string {
  const c = new Chess()
  for (const s of sans) c.move(s)
  return c.fen().split(' ').slice(0, 4).join(' ')
}

/** One-chapter course from (fen, san) pairs forming a single line. */
function courseOf(
  side: 'white' | 'black',
  positions: Array<{ fen: string; san: string }>,
): CourseSource {
  const cards = positions.map((p, i) => ({
    id: 100 + i,
    chapter_id: 10,
    fen_canonical: p.fen,
  }))
  const steps: PersistedLineStep[] = positions.map((p, i) => ({
    card_id: 100 + i,
    expected_san: p.san,
  }))
  return {
    pgn_id: 1,
    pgn_name: 'Course',
    chapters: [{ id: 10, user_side: side }],
    cards,
    lines: [{ id: 1000, chapter_id: 10, dfs_index: 0, steps }],
  }
}

const INITIAL_CANON = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -'

/** White repertoire: 1. e4 e5 2. Nf3 */
function whiteIndex() {
  const course: CourseSource = {
    pgn_id: 1,
    pgn_name: 'King Pawn',
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
          { card_id: 101, expected_san: 'Nf3' },
        ],
      },
    ],
  }
  return buildRepertoireIndex([course])
}

describe('DeviationDetector', () => {
  it('reports no deviations for a game that follows the repertoire', () => {
    const analysis = analyzeGame(
      { sans: ['e4', 'e5', 'Nf3', 'Nc6'], user_color: 'white' },
      whiteIndex(),
    )

    expect(analysis.deviations).toEqual([])
    expect(analysis.matched_move_count).toBe(2)
  })

  it('reports a deviation when the user leaves book at a known position', () => {
    const analysis = analyzeGame(
      { sans: ['e4', 'e5', 'Bc4', 'Nf6'], user_color: 'white' },
      whiteIndex(),
    )

    expect(analysis.matched_move_count).toBe(1)
    expect(analysis.deviations).toHaveLength(1)
    const dev = analysis.deviations[0]
    expect(dev.played_san).toBe('Bc4')
    expect(dev.move_number).toBe(2)
    expect(dev.expected.map((m) => m.san)).toEqual(['Nf3'])
    expect(dev.expected[0].card_id).toBe(101)
    expect(dev.expected[0].line_id).toBe(1000)
    // Full FEN so the board can render the position directly.
    expect(dev.fen_before).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    )
  })

  it('ends coverage silently when the opponent leaves book — never a user deviation', () => {
    // Repertoire covers 1. e4 e5 2. Nf3; opponent plays 1... c5 instead.
    const analysis = analyzeGame(
      { sans: ['e4', 'c5', 'Nc3', 'Nc6'], user_color: 'white' },
      whiteIndex(),
    )

    expect(analysis.deviations).toEqual([])
    expect(analysis.matched_move_count).toBe(1)
  })

  it('matches by position, so a transposed move order still lands in book', () => {
    // Black repertoire vs 1. e4: 1... c5, then 2. Nf3 d6.
    const index = buildRepertoireIndex([
      courseOf('black', [
        { fen: canonAfter(['e4']), san: 'c5' },
        { fen: canonAfter(['e4', 'c5', 'Nf3']), san: 'd6' },
      ]),
    ])

    // The game opens 1. Nf3 (not covered) and transposes: after 2. e4 the
    // position equals the repertoire's 2... d6 card.
    const inBook = analyzeGame(
      { sans: ['Nf3', 'c5', 'e4', 'd6'], user_color: 'black' },
      index,
    )
    expect(inBook.deviations).toEqual([])
    expect(inBook.matched_move_count).toBe(1)

    // Same transposition, wrong reply: flagged with the transposed expectation.
    const offBook = analyzeGame(
      { sans: ['Nf3', 'c5', 'e4', 'g6'], user_color: 'black' },
      index,
    )
    expect(offBook.deviations).toHaveLength(1)
    expect(offBook.deviations[0].expected.map((m) => m.san)).toEqual(['d6'])
  })

  it('keeps analyzing after a deviation and reports every one (re-entry via transposition)', () => {
    // White repertoire: 1. Nf3 Nf6 2. g3 g6 3. Bg2.
    const index = buildRepertoireIndex([
      courseOf('white', [
        { fen: canonAfter([]), san: 'Nf3' },
        { fen: canonAfter(['Nf3', 'Nf6']), san: 'g3' },
        { fen: canonAfter(['Nf3', 'Nf6', 'g3', 'g6']), san: 'Bg2' },
      ]),
    ])

    // 1. g3 deviates, 2. Nf3 transposes back into book, 3. Bh3 deviates again.
    const analysis = analyzeGame(
      { sans: ['g3', 'Nf6', 'Nf3', 'g6', 'Bh3'], user_color: 'white' },
      index,
    )

    expect(analysis.deviations).toHaveLength(2)
    expect(analysis.deviations[0]).toMatchObject({
      ply: 1,
      played_san: 'g3',
    })
    expect(analysis.deviations[0].expected.map((m) => m.san)).toEqual(['Nf3'])
    expect(analysis.deviations[1]).toMatchObject({
      ply: 5,
      move_number: 3,
      played_san: 'Bh3',
    })
    expect(analysis.deviations[1].expected.map((m) => m.san)).toEqual(['Bg2'])
  })

  it('accepts any sibling line the repertoire contains at that position', () => {
    const course = courseOf('white', [
      { fen: canonAfter([]), san: 'e4' },
      { fen: canonAfter(['e4', 'e5']), san: 'Nf3' },
    ])
    course.lines.push({
      id: 1001,
      chapter_id: 10,
      dfs_index: 1,
      steps: [
        { card_id: 100, expected_san: 'e4' },
        { card_id: 101, expected_san: 'Bc4' },
      ],
    })
    const index = buildRepertoireIndex([course])

    const analysis = analyzeGame(
      { sans: ['e4', 'e5', 'Bc4', 'Nf6'], user_color: 'white' },
      index,
    )

    expect(analysis.deviations).toEqual([])
    expect(analysis.matched_move_count).toBe(2)
  })

  it('tolerates check-suffix differences between course SANs and game SANs', () => {
    // Course stored the move without the check mark; the export writes Bb4+.
    const index = buildRepertoireIndex([
      courseOf('black', [
        {
          fen: canonAfter(['d4', 'Nf6', 'c4', 'e6', 'Nc3']),
          san: 'Bb4',
        },
      ]),
    ])

    const analysis = analyzeGame(
      {
        sans: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4+'],
        user_color: 'black',
      },
      index,
    )

    expect(analysis.deviations).toEqual([])
    expect(analysis.matched_move_count).toBe(1)
  })

  it('analyzes the legal prefix of a corrupt game and drops the rest', () => {
    const analysis = analyzeGame(
      { sans: ['e4', 'e5', 'Qxf7', 'Kxf7'], user_color: 'white' },
      whiteIndex(),
    )

    expect(analysis.matched_move_count).toBe(1)
    expect(analysis.deviations).toEqual([])
  })
})
