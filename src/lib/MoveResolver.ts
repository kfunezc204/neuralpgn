import { Chess, type Square } from 'chess.js'

export interface ResolvedMove {
  san: string
  uci: string
  fen_after: string
}

export function sanToFromTo(
  fen: string,
  san: string,
): { from: string; to: string } | null {
  const chess = new Chess(fen)
  try {
    const move = chess.move(san)
    if (!move) return null
    return { from: move.from, to: move.to }
  } catch {
    return null
  }
}

export function legalDests(fen: string): Map<string, string[]> {
  const chess = new Chess(fen)
  const dests = new Map<string, string[]>()
  for (const m of chess.moves({ verbose: true })) {
    const list = dests.get(m.from) ?? []
    list.push(m.to)
    dests.set(m.from, list)
  }
  return dests
}

export function expandSanSequence(
  startFen: string,
  sans: readonly string[],
): Array<{ san: string; fen_before: string; fen_after: string }> {
  const chess = new Chess(startFen)
  const out: Array<{ san: string; fen_before: string; fen_after: string }> = []
  for (const san of sans) {
    const fen_before = chess.fen()
    try {
      chess.move(san)
    } catch {
      break
    }
    out.push({ san, fen_before, fen_after: chess.fen() })
  }
  return out
}

// Finds the single legal move that transforms fenFrom into fenTo (canonical
// 4-field comparison), or null when no legal move connects them. Used to
// reconstruct the opponent's reply between two consecutive user steps in
// fixed-side chapters, where line.steps only store the user's moves.
export function findConnectingMove(
  fenFrom: string,
  fenTo: string,
): { san: string; from: string; to: string } | null {
  const canon = (fen: string) => fen.split(' ').slice(0, 4).join(' ')
  // Card FENs are stored canonical (4 fields); chess.js wants all 6.
  const padded = (fen: string) => {
    const parts = fen.split(' ')
    while (parts.length < 6) parts.push(parts.length === 4 ? '0' : '1')
    return parts.join(' ')
  }
  let chess: Chess
  let target: string
  try {
    chess = new Chess(padded(fenFrom))
    // Round-trip the target through chess.js so the en-passant field is
    // normalized the same way as m.after (chess.js omits non-capturable ep
    // squares from fen()).
    target = canon(new Chess(padded(fenTo)).fen())
  } catch {
    return null
  }
  for (const m of chess.moves({ verbose: true })) {
    if (canon(m.after) === target) {
      return { san: m.san, from: m.from, to: m.to }
    }
  }
  return null
}

export function resolveMove(
  fen: string,
  from: string,
  to: string,
  promotion?: 'q' | 'r' | 'b' | 'n',
): ResolvedMove | null {
  const chess = new Chess(fen)
  try {
    const move = chess.move({
      from: from as Square,
      to: to as Square,
      promotion,
    })
    if (!move) return null
    return {
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ''),
      fen_after: chess.fen(),
    }
  } catch {
    return null
  }
}
