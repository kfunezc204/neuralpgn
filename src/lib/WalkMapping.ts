import type { PersistedCard, PersistedLine } from './Repository.ts'
import type { Card, Line, UserSide } from './types.ts'

// Persisted rows reference cards by integer DB id; the in-memory WalkEngine
// works in string ids (it predates persistence and is shared with the ingestor
// path). These mappers are the single crossing point between the two id worlds.
// Both WalkCore and GlobalWalkView drive a WalkEngine, so they share them.

export function persistedToCard(p: PersistedCard): Card {
  const c: Card = {
    id: String(p.id),
    chapter_id: String(p.chapter_id),
    fen_canonical: p.fen_canonical,
    refutations: p.refutations,
  }
  if (p.comment) c.comment = p.comment
  if (p.shapes) c.shapes = p.shapes
  return c
}

export function persistedToLine(l: PersistedLine): Line {
  return {
    id: String(l.id),
    chapter_id: String(l.chapter_id),
    dfs_index: l.dfs_index,
    steps: l.steps.map((s) => ({
      card_id: String(s.card_id),
      expected_san: s.expected_san,
    })),
    ...(l.intro_comment ? { intro_comment: l.intro_comment } : {}),
  }
}

// Board orientation for the trainee. 'stm' chapters (puzzles) derive the side
// from the position's side-to-move; fixed-side chapters use the declared side.
export function orientationFor(
  userSide: UserSide,
  fen: string,
): 'white' | 'black' {
  if (userSide === 'stm') {
    return fen.split(' ')[1] === 'b' ? 'black' : 'white'
  }
  return userSide === 'black' ? 'black' : 'white'
}
