export type WalkHistoryEntry =
  | { kind: 'correct'; san: string; comment?: string }
  | {
      kind: 'wrong'
      expected: string
      played: string
      comment?: string
    }
  | { kind: 'auto'; san: string }
  | {
      kind: 'refutation'
      played: string
      continuation: string[]
      comment?: string
    }
  | { kind: 'replay'; san: string; comment?: string }

export type WalkHistory = ReadonlyArray<WalkHistoryEntry>

export function emptyHistory(): WalkHistoryEntry[] {
  return []
}

export function recordHistory(
  prev: WalkHistory,
  entry: WalkHistoryEntry,
): WalkHistoryEntry[] {
  return [...prev, entry]
}
