import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { LineScheduler } from '../LineScheduler.ts'
import { Repository } from '../Repository.ts'

const LINEAR_PGN = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

async function seedSingleLine() {
  const repo = await freshRepo()
  const result = new PgnIngestor().ingest(LINEAR_PGN)
  const pgnId = await repo.savePgn({ name: 'Test PGN', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const [line] = await repo.getLinesForChapter(chapter.id)
  return { repo, pgnId, chapter, line }
}

describe('Repository — deleteLineHard', () => {
  it('removes an archived line plus its line_state and review_event history in one go', async () => {
    const { repo, line } = await seedSingleLine()

    const sched = new LineScheduler()
    let state = sched.initial(new Date('2025-01-01T00:00:00Z'))
    state = sched.next(
      state,
      'pass_all_first',
      new Date('2025-01-02T00:00:00Z'),
    )
    await repo.saveLineState(line.id, state)
    await repo.logReviewEvent({
      line_id: line.id,
      ts: new Date('2025-01-02T00:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
    })

    await repo.archiveLine(line.id)
    await repo.deleteLineHard(line.id)

    expect(await repo.getLine(line.id)).toBeNull()
    expect(await repo.getLineState(line.id)).toBeNull()
    const dump = await repo.dumpAll()
    const remaining = (dump.review_events as Array<{ line_id: number }>).filter(
      (e) => e.line_id === line.id,
    )
    expect(remaining).toHaveLength(0)
  })

  it('leaves cards untouched (cards are shared at chapter scope, not owned by the line)', async () => {
    const { repo, chapter, line } = await seedSingleLine()
    const cardsBefore = await repo.getCardsForChapter(chapter.id)
    expect(cardsBefore.length).toBeGreaterThan(0)

    await repo.archiveLine(line.id)
    await repo.deleteLineHard(line.id)

    const cardsAfter = await repo.getCardsForChapter(chapter.id)
    expect(cardsAfter.map((c) => c.id)).toEqual(cardsBefore.map((c) => c.id))
  })

  it('refuses to hard-delete a line that is not archived (defense: deletion must go through Archive)', async () => {
    const { repo, line } = await seedSingleLine()

    await expect(repo.deleteLineHard(line.id)).rejects.toThrow()
    // Line still in place because the guard fired before any DELETE.
    expect(await repo.getLine(line.id)).not.toBeNull()
  })

  it('a second deleteLineHard on the same id rejects (the row is gone, no-op is not silent)', async () => {
    const { repo, line } = await seedSingleLine()
    await repo.archiveLine(line.id)
    await repo.deleteLineHard(line.id)

    await expect(repo.deleteLineHard(line.id)).rejects.toThrow()
  })

  it('deleting the parent PGN cascade-removes its archived lines too (no FK orphans block the delete)', async () => {
    const { repo, pgnId, line } = await seedSingleLine()
    await repo.archiveLine(line.id)

    await repo.deletePgn(pgnId)

    expect(await repo.getArchivedLinesForPgn(pgnId)).toEqual([])
    expect(await repo.getLine(line.id)).toBeNull()
  })
})
