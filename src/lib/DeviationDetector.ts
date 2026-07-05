import { Chess } from 'chess.js'
import type {
  ExpectedMove,
  RepertoireColor,
  RepertoireIndex,
} from './RepertoireIndex.ts'

/**
 * Replays one real game against the repertoire index and reports every
 * position where the USER left book. Lookup is per-position and stateless,
 * which gives the agreed semantics for free: transpositions into book are
 * compared, coverage silently ends when the opponent leaves book, and
 * analysis re-activates if the game transposes back.
 */
export interface DetectedDeviation {
  /** 1-based halfmove index into the game. */
  ply: number
  move_number: number
  /** Full 6-field FEN of the position the user faced (board-renderable). */
  fen_before: string
  /** Canonical SAN as validated by chess.js. */
  played_san: string
  /** Every move the active repertoire accepts here; never empty. */
  expected: ExpectedMove[]
}

export interface GameAnalysis {
  deviations: DetectedDeviation[]
  /** User moves that were found in book and matched the repertoire. */
  matched_move_count: number
}

export interface GameInput {
  sans: readonly string[]
  user_color: RepertoireColor
}

/** Check/mate suffixes vary across export sources; equality must not. */
function sanBase(san: string): string {
  return san.replace(/[+#]+$/, '')
}

export function analyzeGame(
  game: GameInput,
  index: RepertoireIndex,
): GameAnalysis {
  const chess = new Chess()
  const userTurn = game.user_color === 'white' ? 'w' : 'b'
  const deviations: DetectedDeviation[] = []
  let matched = 0

  for (let i = 0; i < game.sans.length; i++) {
    const fenBefore = chess.fen()
    const isUserMove = chess.turn() === userTurn

    let playedSan: string
    try {
      playedSan = chess.move(game.sans[i]).san
    } catch {
      // Corrupt or truncated export: analyze the legal prefix, drop the rest.
      break
    }

    if (!isUserMove) continue
    const entry = index.lookup(game.user_color, fenBefore)
    if (!entry) continue

    const inBook = entry.moves.some(
      (m) => sanBase(m.san) === sanBase(playedSan),
    )
    if (inBook) {
      matched++
    } else {
      deviations.push({
        ply: i + 1,
        move_number: Math.floor(i / 2) + 1,
        fen_before: fenBefore,
        played_san: playedSan,
        expected: entry.moves,
      })
    }
  }

  return { deviations, matched_move_count: matched }
}
