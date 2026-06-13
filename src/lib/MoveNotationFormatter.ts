import type { WalkHistoryEntry } from './WalkHistory.ts'

export type SanStyle = 'correct' | 'wrong' | 'auto' | 'replay'

export type MoveFlowToken =
  | { kind: 'move-number'; text: string }
  | {
      kind: 'san'
      text: string
      style: SanStyle
      index: number
      isCurrentReplay: boolean
    }
  | { kind: 'refutation-parens'; moves: string[] }
  | { kind: 'comment'; text: string }

export interface FormatArgs {
  history: ReadonlyArray<WalkHistoryEntry>
  initialFen: string | null
  currentReplayIndex?: number | null
}

interface PlyContext {
  moveNum: number
  isWhite: boolean
}

function parseStart(initialFen: string | null): { startMove: number; startSide: 'w' | 'b' } {
  if (!initialFen) return { startMove: 1, startSide: 'w' }
  const fields = initialFen.split(' ')
  const side = fields[1] === 'b' ? 'b' : 'w'
  const move = Number.parseInt(fields[5] ?? '', 10)
  return {
    startMove: Number.isFinite(move) && move > 0 ? move : 1,
    startSide: side,
  }
}

function plyContext(
  i: number,
  startMove: number,
  startSide: 'w' | 'b',
): PlyContext {
  if (startSide === 'w') {
    return { moveNum: startMove + Math.floor(i / 2), isWhite: i % 2 === 0 }
  }
  return { moveNum: startMove + Math.floor((i + 1) / 2), isWhite: i % 2 === 1 }
}

function entryRenderableSan(entry: WalkHistoryEntry): { text: string; style: SanStyle } {
  switch (entry.kind) {
    case 'correct':
      return { text: entry.san, style: 'correct' }
    case 'wrong':
      return { text: entry.played, style: 'wrong' }
    case 'auto':
      return { text: entry.san, style: 'auto' }
    case 'refutation':
      return { text: entry.played, style: 'wrong' }
    case 'replay':
      return { text: entry.san, style: 'replay' }
  }
}

export function formatHistoryAsPgnFlow({
  history,
  initialFen,
  currentReplayIndex,
}: FormatArgs): MoveFlowToken[] {
  if (history.length === 0) return []
  const tokens: MoveFlowToken[] = []
  const { startMove, startSide } = parseStart(initialFen)

  for (let i = 0; i < history.length; i++) {
    const entry = history[i]
    const { moveNum, isWhite } = plyContext(i, startMove, startSide)

    // Emit a move-number token before white moves; emit "N..." for the
    // first ply when it's black (mid-game start).
    if (isWhite) {
      tokens.push({ kind: 'move-number', text: `${moveNum}.` })
    } else if (i === 0) {
      tokens.push({ kind: 'move-number', text: `${moveNum}...` })
    }

    const { text, style } = entryRenderableSan(entry)
    tokens.push({
      kind: 'san',
      text,
      style,
      index: i,
      isCurrentReplay:
        entry.kind === 'replay' &&
        currentReplayIndex !== null &&
        currentReplayIndex !== undefined &&
        currentReplayIndex === i,
    })

    if (entry.kind === 'refutation' && entry.continuation.length > 0) {
      tokens.push({ kind: 'refutation-parens', moves: [...entry.continuation] })
    }

    if ('comment' in entry && entry.comment) {
      tokens.push({ kind: 'comment', text: entry.comment })
    }
  }

  return tokens
}
