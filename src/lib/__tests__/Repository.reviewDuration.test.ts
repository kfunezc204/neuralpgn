import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'

const LINEAR_PGN = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

async function repoWithLine() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(LINEAR_PGN)
  const pgnId = await repo.savePgn({ name: 'Pack', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const [line] = await repo.getLinesForChapter(chapter.id)
  return { repo, lineId: line.id }
}

describe('Repository — review event duration', () => {
  it('persists the duration with the review event and dumps it', async () => {
    const { repo, lineId } = await repoWithLine()

    await repo.logReviewEvent({
      line_id: lineId,
      ts: new Date('2026-06-12T10:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
      duration_ms: 14250,
    })

    const snap = await repo.dumpAll()
    const event = snap.review_events[0] as Record<string, unknown>
    expect(event.duration_ms).toBe(14250)
  })

  it('events logged without duration store NULL (teach-era and non-timed paths)', async () => {
    const { repo, lineId } = await repoWithLine()

    await repo.logReviewEvent({
      line_id: lineId,
      ts: new Date('2026-06-12T10:00:00Z'),
      outcome: 'fail',
      retries_used_count: 1,
      rating: 'Again',
    })

    const snap = await repo.dumpAll()
    const event = snap.review_events[0] as Record<string, unknown>
    expect(event.duration_ms).toBeNull()
  })

  it('restores a backup whose events predate the duration column', async () => {
    const { repo, lineId } = await repoWithLine()
    await repo.logReviewEvent({
      line_id: lineId,
      ts: new Date('2026-06-12T10:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
      duration_ms: 9000,
    })
    const snap = await repo.dumpAll()
    snap.review_events = snap.review_events.map((row) => {
      const { duration_ms: _omitted, ...rest } = row as Record<string, unknown>
      return rest
    })

    const restored = new Repository(openInMemoryAdapter())
    await restored.migrate()
    await restored.restoreAll(snap)

    const restoredSnap = await restored.dumpAll()
    const event = restoredSnap.review_events[0] as Record<string, unknown>
    expect(event.duration_ms).toBeNull()
  })
})

describe('Repository — first-try rate per course', () => {
  it('aggregates pass_all_first against all review events of the course', async () => {
    const { repo, lineId } = await repoWithLine()
    const log = (outcome: 'pass_all_first' | 'pass_with_retry' | 'fail') =>
      repo.logReviewEvent({
        line_id: lineId,
        ts: new Date('2026-06-12T10:00:00Z'),
        outcome,
        retries_used_count: 0,
        rating: outcome === 'pass_all_first' ? 'Good' : 'Again',
      })
    await log('pass_all_first')
    await log('pass_all_first')
    await log('pass_with_retry')
    await log('fail')

    const pgns = await repo.listPgns()
    const rate = await repo.getFirstTryStatsForPgn(pgns[0].id)
    expect(rate).toEqual({ first_try: 2, total: 4 })
  })

  it('a course without attempts reports zero totals (UI shows empty state)', async () => {
    const { repo } = await repoWithLine()
    const pgns = await repo.listPgns()
    expect(await repo.getFirstTryStatsForPgn(pgns[0].id)).toEqual({
      first_try: 0,
      total: 0,
    })
  })
})
