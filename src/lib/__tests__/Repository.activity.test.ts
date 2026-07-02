import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'
import type { ReviewRating } from '../Repository.ts'

const BRANCHED_PGN = `[Event "Ch"]
[White "?"]
[Black "?"]
[Result "*"]

1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *
`

async function seedTwoLines() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(BRANCHED_PGN)
  const pgnId = await repo.savePgn({ name: 'Test', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const lines = await repo.getLinesForChapter(chapter.id)
  return { repo, pgnId, lines }
}

async function logEvent(
  repo: Repository,
  lineId: number,
  ts: string,
  rating: ReviewRating = 'Good',
) {
  await repo.logReviewEvent({
    line_id: lineId,
    ts: new Date(ts),
    outcome: 'pass_all_first',
    retries_used_count: 0,
    rating,
  })
}

describe('Repository — getReviewActivitySince', () => {
  it("returns events since the cutoff with each line's first-ever timestamp", async () => {
    const { repo, lines } = await seedTwoLines()
    // Line 0: learned long ago, reviewed today.
    await logEvent(repo, lines[0].id, '2026-06-01T10:00:00.000Z')
    await logEvent(repo, lines[0].id, '2026-06-11T09:00:00.000Z')
    // Line 1: first event today.
    await logEvent(repo, lines[1].id, '2026-06-11T10:00:00.000Z')

    const rows = await repo.getReviewActivitySince(
      new Date('2026-06-11T00:00:00.000Z'),
    )

    expect(rows).toHaveLength(2)
    const byLine = new Map(rows.map((r) => [r.lineId, r]))
    expect(byLine.get(lines[0].id)!.firstEverTs.toISOString()).toBe(
      '2026-06-01T10:00:00.000Z',
    )
    expect(byLine.get(lines[1].id)!.firstEverTs.toISOString()).toBe(
      '2026-06-11T10:00:00.000Z',
    )
  })
})

describe('Repository — getPgnCounters.learnedThisWeek', () => {
  it('counts lines first reviewed within the last 7 days, not older ones', async () => {
    const { repo, pgnId, lines } = await seedTwoLines()
    const now = new Date('2026-06-11T14:00:00.000Z')
    // Line 0: learned 20 days ago (outside the window), reviewed yesterday.
    await logEvent(repo, lines[0].id, '2026-05-22T10:00:00.000Z')
    await logEvent(repo, lines[0].id, '2026-06-10T10:00:00.000Z')
    // Line 1: first event 2 days ago (inside the window).
    await logEvent(repo, lines[1].id, '2026-06-09T10:00:00.000Z')

    const counters = await repo.getPgnCounters(pgnId, now)

    expect(counters.learnedThisWeek).toBe(1)
  })

  it('does not count archived lines', async () => {
    const { repo, pgnId, lines } = await seedTwoLines()
    const now = new Date('2026-06-11T14:00:00.000Z')
    await logEvent(repo, lines[1].id, '2026-06-09T10:00:00.000Z')
    await repo.archiveLine(lines[1].id)

    const counters = await repo.getPgnCounters(pgnId, now)

    expect(counters.learnedThisWeek).toBe(0)
  })
})
