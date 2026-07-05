// Weak-point deck: aggregates quiz misses and puzzle attempts per card into
// the set of positions that deserve reinforcement. Pure logic — Repository
// supplies the rows, PuzzleSessionView renders the result.

export type MoveMissKind =
  | 'retry'
  | 'double_fail'
  | 'refutation'
  | 'game_deviation'

export const MISS_WEIGHT: Record<MoveMissKind, number> = {
  retry: 1,
  double_fail: 2,
  refutation: 2,
  // Leaving book in a real game is a proven gap, not a maybe: straight into the deck.
  game_deviation: 2,
}

// A position enters the deck once its accumulated score reaches the
// threshold (one serious fail, or two recovered retries) and leaves it after
// GRADUATION_STREAK consecutive correct puzzle solves. A failed puzzle
// attempt adds 1 to the score and breaks the streak.
export const ENTRY_THRESHOLD = 2
export const GRADUATION_STREAK = 3
export const SESSION_CAP = 20

export interface WeakPointMiss {
  card_id: number
  line_id: number
  ts: Date
  kind: MoveMissKind
}

export interface WeakPointAttempt {
  card_id: number
  ts: Date
  correct: boolean
}

export interface WeakPoint {
  card_id: number
  score: number
  /** Trailing consecutive correct puzzle solves (misses break it). */
  streak: number
  /** Lines this card was missed in, most recent first (deduped). */
  line_ids: number[]
}

interface CardAccumulator {
  score: number
  // tie: attempts sort before misses at the same timestamp, so a same-instant
  // miss still breaks the streak (conservative).
  events: { ts: number; tie: number; pass: boolean }[]
  missLines: { line_id: number; ts: number }[]
  lastTs: number
}

/**
 * Count weak points whose source lines are not all archived — the number the
 * 🎯 badge shows. Shared by the course header and the library card so the two
 * never disagree.
 */
export async function fetchActiveWeakPointCount(
  repo: {
    getMoveMissesForPgn(pgnId: number): Promise<WeakPointMiss[]>
    getPuzzleAttemptsForPgn(pgnId: number): Promise<WeakPointAttempt[]>
    getArchivedLinesForPgn(
      pgnId: number,
    ): Promise<Array<{ line: { id: number } }>>
  },
  pgnId: number,
): Promise<number> {
  const [misses, attempts, archived] = await Promise.all([
    repo.getMoveMissesForPgn(pgnId),
    repo.getPuzzleAttemptsForPgn(pgnId),
    repo.getArchivedLinesForPgn(pgnId),
  ])
  const archivedIds = new Set(archived.map((e) => e.line.id))
  return buildWeakPoints(misses, attempts).filter((wp) =>
    wp.line_ids.some((lid) => !archivedIds.has(lid)),
  ).length
}

export function buildWeakPoints(
  misses: WeakPointMiss[],
  attempts: WeakPointAttempt[],
): WeakPoint[] {
  const byCard = new Map<number, CardAccumulator>()
  const acc = (cardId: number): CardAccumulator => {
    let a = byCard.get(cardId)
    if (!a) {
      a = { score: 0, events: [], missLines: [], lastTs: 0 }
      byCard.set(cardId, a)
    }
    return a
  }

  for (const m of misses) {
    const a = acc(m.card_id)
    const ts = m.ts.getTime()
    a.score += MISS_WEIGHT[m.kind]
    a.events.push({ ts, tie: 1, pass: false })
    a.missLines.push({ line_id: m.line_id, ts })
    if (ts > a.lastTs) a.lastTs = ts
  }
  for (const at of attempts) {
    const a = acc(at.card_id)
    const ts = at.ts.getTime()
    if (!at.correct) a.score += 1
    a.events.push({ ts, tie: 0, pass: at.correct })
    if (ts > a.lastTs) a.lastTs = ts
  }

  const out: (WeakPoint & { lastTs: number })[] = []
  for (const [card_id, a] of byCard) {
    a.events.sort((x, y) => x.ts - y.ts || x.tie - y.tie)
    let streak = 0
    for (let i = a.events.length - 1; i >= 0 && a.events[i].pass; i--) {
      streak++
    }
    if (a.score < ENTRY_THRESHOLD || streak >= GRADUATION_STREAK) continue

    a.missLines.sort((x, y) => y.ts - x.ts)
    const line_ids: number[] = []
    for (const ml of a.missLines) {
      if (!line_ids.includes(ml.line_id)) line_ids.push(ml.line_id)
    }
    out.push({ card_id, score: a.score, streak, line_ids, lastTs: a.lastTs })
  }

  // Worst first; recency breaks score ties, card id keeps it deterministic.
  out.sort(
    (x, y) => y.score - x.score || y.lastTs - x.lastTs || x.card_id - y.card_id,
  )
  return out.map(({ lastTs: _lastTs, ...wp }) => wp)
}
