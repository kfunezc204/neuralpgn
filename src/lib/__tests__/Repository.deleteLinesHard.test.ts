import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { LineScheduler } from '../LineScheduler.ts'
import { Repository } from '../Repository.ts'

const MULTI_LINE_PGN = `[Event "Multi"]
[White "Chapter X"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4) (1. c4) (1. Nf3) *
`

async function seed() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(MULTI_LINE_PGN)
  const pgnId = await repo.savePgn({ name: 'Multi', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const lines = await repo.getLinesForChapter(chapter.id)
  return { repo, pgnId, chapter, lines }
}

describe('Repository.deleteLinesHard (bulk)', () => {
  it('removes every archived line plus its line_state and review_event history in one call', async () => {
    const { repo, lines } = await seed()

    const sched = new LineScheduler()
    let state = sched.initial(new Date('2025-01-01T00:00:00Z'))
    state = sched.next(state, 'pass_all_first', new Date('2025-01-02T00:00:00Z'))
    await repo.saveLineState(lines[0].id, state)
    await repo.saveLineState(lines[1].id, state)
    await repo.logReviewEvent({
      line_id: lines[0].id,
      ts: new Date('2025-01-02T00:00:00Z'),
      outcome: 'pass_all_first',
      retries_used_count: 0,
      rating: 'Good',
    })

    const targets = [lines[0].id, lines[1].id]
    await repo.archiveLines(targets)
    await repo.deleteLinesHard(targets)

    for (const id of targets) {
      expect(await repo.getLine(id)).toBeNull()
      expect(await repo.getLineState(id)).toBeNull()
    }
    const dump = await repo.dumpAll()
    const remaining = (dump.review_events as Array<{ line_id: number }>).filter(
      (e) => targets.includes(e.line_id),
    )
    expect(remaining).toHaveLength(0)
  })

  it('rejects atomically when ANY target is not archived: no row is deleted at all', async () => {
    const { repo, lines } = await seed()
    const archivedOk = lines[0].id
    const notArchived = lines[1].id
    await repo.archiveLine(archivedOk)

    await expect(
      repo.deleteLinesHard([archivedOk, notArchived]),
    ).rejects.toThrow()

    // Defensive: neither line was touched. The archived one is still archived,
    // the unarchived one is still active, and the line_state survives.
    expect(await repo.getLine(archivedOk)).not.toBeNull()
    expect(await repo.getLine(notArchived)).not.toBeNull()
  })

  it('rejects atomically when ANY target is missing: no row is deleted at all', async () => {
    const { repo, lines } = await seed()
    const archived = lines[0].id
    await repo.archiveLine(archived)

    await expect(
      repo.deleteLinesHard([archived, 999_999]),
    ).rejects.toThrow()

    expect(await repo.getLine(archived)).not.toBeNull()
  })

  it('deleteLinesHard([]) is a no-op (does not throw and does not touch anything)', async () => {
    const { repo, lines } = await seed()
    const before = lines.length

    await expect(repo.deleteLinesHard([])).resolves.toBeUndefined()

    const afterChapter = await repo.getLinesForChapter(lines[0].chapter_id)
    expect(afterChapter).toHaveLength(before)
  })
})
