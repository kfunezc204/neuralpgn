import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'

const TWO_CHAPTERS_PGN = `[Event "Lesson A"]
[White "Chapter One"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4) *

[Event "Lesson B"]
[White "Chapter Two"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. c4 (1. Nf3) *
`

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

function reviewState(due: Date) {
  return {
    stability: 5,
    difficulty: 5,
    due,
    state: 'review' as const,
    reps: 1,
    lapses: 0,
    consecutive_correct: 1,
    last_review: new Date('2025-04-01T00:00:00Z'),
  }
}

describe('Repository — PGN-scoped line getters', () => {
  it('getLinesForPgn returns every active line across chapters, in chapter then dfs order, excluding archived', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Scoped', result })
    const chapters = await repo.getChaptersForPgn(pgnId)

    const all = await repo.getLinesForPgn(pgnId)
    expect(all).toHaveLength(4)
    // Chapter-major order, dfs within.
    expect(all.map((l) => l.chapter_id)).toEqual([
      chapters[0].id,
      chapters[0].id,
      chapters[1].id,
      chapters[1].id,
    ])
    expect(all[0].dfs_index).toBeLessThan(all[1].dfs_index)

    // Per-chapter getter must agree with the grouped view.
    const perChapter = [
      ...(await repo.getLinesForChapter(chapters[0].id)),
      ...(await repo.getLinesForChapter(chapters[1].id)),
    ]
    expect(all.map((l) => l.id)).toEqual(perChapter.map((l) => l.id))

    // Archiving removes the line from the PGN-wide view too.
    await repo.archiveLine(all[0].id)
    const afterArchive = await repo.getLinesForPgn(pgnId)
    expect(afterArchive.map((l) => l.id)).toEqual(all.slice(1).map((l) => l.id))
  })

  it('getLineStatesForPgn returns states for all chapters, scoped by profile and excluding archived lines', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'States', result })
    const lines = await repo.getLinesForPgn(pgnId)

    const due = new Date('2025-05-01T00:00:00Z')
    await repo.saveLineState(lines[0].id, reviewState(due))
    await repo.saveLineState(lines[2].id, reviewState(due))
    await repo.saveLineState(lines[3].id, reviewState(due), 'other_profile')

    const states = await repo.getLineStatesForPgn(pgnId)
    expect(states.map((s) => s.line_id).sort()).toEqual(
      [lines[0].id, lines[2].id].sort(),
    )

    const other = await repo.getLineStatesForPgn(pgnId, 'other_profile')
    expect(other.map((s) => s.line_id)).toEqual([lines[3].id])

    // Archived lines drop out of the state view.
    await repo.archiveLine(lines[0].id)
    const afterArchive = await repo.getLineStatesForPgn(pgnId)
    expect(afterArchive.map((s) => s.line_id)).toEqual([lines[2].id])
  })
})

describe('Repository — getAllPgnCounters', () => {
  it('aggregates counters per PGN without cross-course bleed and matches getPgnCounters', async () => {
    const repo = await freshRepo()
    const resultA = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const resultB = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnA = await repo.savePgn({ name: 'Course A', result: resultA })
    const pgnB = await repo.savePgn({ name: 'Course B', result: resultB })

    const now = new Date('2025-06-01T00:00:00Z')
    const past = new Date('2025-05-01T00:00:00Z')

    // Course A: one learned+due line. Course B: untouched (all new).
    const [firstA] = await repo.getLinesForPgn(pgnA)
    await repo.saveLineState(firstA.id, reviewState(past))

    const all = await repo.getAllPgnCounters(now)
    expect(all.get(pgnA)).toEqual({
      total: 4,
      learned: 1,
      mastered: 0,
      due: 1,
      nextDueAt: past,
      learnedThisWeek: 0,
    })
    expect(all.get(pgnB)).toEqual({
      total: 4,
      learned: 0,
      mastered: 0,
      due: 0,
      nextDueAt: null,
      learnedThisWeek: 0,
    })

    // Single-PGN wrapper agrees with the aggregate.
    expect(await repo.getPgnCounters(pgnA, now)).toEqual(all.get(pgnA))
    expect(await repo.getPgnCounters(pgnB, now)).toEqual(all.get(pgnB))
  })

  it('counts learnedThisWeek per PGN from first-ever review events', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Weekly', result })
    const lines = await repo.getLinesForPgn(pgnId)

    const now = new Date('2025-06-08T00:00:00Z')
    // First event within the window → counts.
    await repo.logReviewEvent({
      line_id: lines[0].id,
      ts: new Date('2025-06-05T00:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
    })
    // First event before the window → does not count, even with a recent one.
    await repo.logReviewEvent({
      line_id: lines[1].id,
      ts: new Date('2025-05-01T00:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
    })
    await repo.logReviewEvent({
      line_id: lines[1].id,
      ts: new Date('2025-06-06T00:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
    })

    const all = await repo.getAllPgnCounters(now)
    expect(all.get(pgnId)?.learnedThisWeek).toBe(1)
  })

  it('getPgnCounters returns all-zero counters for a PGN with no lines', async () => {
    const repo = await freshRepo()
    const counters = await repo.getPgnCounters(999, new Date())
    expect(counters).toEqual({
      total: 0,
      learned: 0,
      mastered: 0,
      due: 0,
      nextDueAt: null,
      learnedThisWeek: 0,
    })
  })
})
