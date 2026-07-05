import type { PersistedLineStep } from './Repository.ts'
import type { UserSide } from './types.ts'

/**
 * Position-indexed view of the user's active repertoire, one per color.
 * Game Check looks positions up by FEN, which is what makes transpositions
 * and re-entry after leaving book work with no extra logic.
 *
 * Callers must feed ACTIVE lines only (the Repository line queries already
 * exclude archived ones); a card reachable solely through archived lines
 * then never enters the index. `stm` chapters are excluded: their "user
 * side" is ambiguous against a real game.
 */
export interface CourseSource {
  pgn_id: number
  pgn_name: string
  chapters: Array<{ id: number; user_side: UserSide }>
  cards: Array<{ id: number; chapter_id: number; fen_canonical: string }>
  lines: Array<{
    id: number
    chapter_id: number
    dfs_index: number
    steps: PersistedLineStep[]
  }>
}

export interface ExpectedMove {
  san: string
  card_id: number
  chapter_id: number
  pgn_id: number
  pgn_name: string
  /** Lowest-dfs active line expecting this move here — the Drill attribution target. */
  line_id: number
}

export interface PositionEntry {
  moves: ExpectedMove[]
}

export type RepertoireColor = 'white' | 'black'

function canonicalFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

export class RepertoireIndex {
  constructor(
    private readonly byColor: Record<
      RepertoireColor,
      Map<string, PositionEntry>
    >,
  ) {}

  lookup(color: RepertoireColor, fen: string): PositionEntry | null {
    return this.byColor[color].get(canonicalFen(fen)) ?? null
  }

  /** True when the color has no indexed positions at all (nothing to compare). */
  isEmpty(color: RepertoireColor): boolean {
    return this.byColor[color].size === 0
  }
}

/** Structural slice of Repository that course loading needs (testable with a fake). */
export interface CourseSourceReader {
  listPgns(): Promise<
    Array<{ id: number; name: string; is_challenge: boolean }>
  >
  getChaptersForPgn(
    pgnId: number,
  ): Promise<Array<{ id: number; user_side: UserSide }>>
  getCardsForChapter(
    chapterId: number,
  ): Promise<Array<{ id: number; chapter_id: number; fen_canonical: string }>>
  getLinesForPgn(pgnId: number): Promise<
    Array<{
      id: number
      chapter_id: number
      dfs_index: number
      steps: PersistedLineStep[]
    }>
  >
}

/**
 * Loads every repertoire course as a CourseSource. getLinesForPgn already
 * returns only active (non-archived) lines, which is exactly the index's
 * contract. Challenge courses (tactics packs) are excluded outright: their
 * positions are exercises, not repertoire, and matching a real game against
 * them produces false deviations.
 */
export async function loadCourseSources(
  repo: CourseSourceReader,
): Promise<CourseSource[]> {
  const pgns = (await repo.listPgns()).filter((p) => !p.is_challenge)
  return Promise.all(
    pgns.map(async (pgn) => {
      const [chapters, lines] = await Promise.all([
        repo.getChaptersForPgn(pgn.id),
        repo.getLinesForPgn(pgn.id),
      ])
      const cardsPerChapter = await Promise.all(
        chapters.map((c) => repo.getCardsForChapter(c.id)),
      )
      return {
        pgn_id: pgn.id,
        pgn_name: pgn.name,
        chapters,
        cards: cardsPerChapter.flat(),
        lines,
      }
    }),
  )
}

export function buildRepertoireIndex(courses: CourseSource[]): RepertoireIndex {
  const byColor: Record<RepertoireColor, Map<string, PositionEntry>> = {
    white: new Map(),
    black: new Map(),
  }

  for (const course of courses) {
    const sideByChapter = new Map<number, UserSide>(
      course.chapters.map((c) => [c.id, c.user_side]),
    )
    const fenByCard = new Map<number, string>(
      course.cards.map((c) => [c.id, c.fen_canonical]),
    )

    // dfs order so the first line claiming a (fen, san) is the lowest-dfs one.
    const lines = [...course.lines].sort(
      (a, b) => a.chapter_id - b.chapter_id || a.dfs_index - b.dfs_index,
    )
    for (const line of lines) {
      const side = sideByChapter.get(line.chapter_id)
      if (side !== 'white' && side !== 'black') continue
      const map = byColor[side]
      for (const step of line.steps) {
        const fen = fenByCard.get(step.card_id)
        if (!fen) continue
        const key = canonicalFen(fen)
        let entry = map.get(key)
        if (!entry) {
          entry = { moves: [] }
          map.set(key, entry)
        }
        if (entry.moves.some((m) => m.san === step.expected_san)) continue
        entry.moves.push({
          san: step.expected_san,
          card_id: step.card_id,
          chapter_id: line.chapter_id,
          pgn_id: course.pgn_id,
          pgn_name: course.pgn_name,
          line_id: line.id,
        })
      }
    }
  }

  return new RepertoireIndex(byColor)
}
