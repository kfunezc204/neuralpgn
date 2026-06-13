import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'
import { BackupSerializer } from '../BackupSerializer.ts'

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

describe('BackupSerializer — archive columns', () => {
  it('round-trips an archived line: snapshot + restore brings back is_archived + archived_at', async () => {
    const source = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await source.savePgn({ name: 'Test', result })
    const [chapter] = await source.getChaptersForPgn(pgnId)
    const [line] = await source.getLinesForChapter(chapter.id)

    const archivedAt = new Date('2025-03-15T12:00:00Z')
    await source.archiveLine(line.id, archivedAt)

    const snap = await new BackupSerializer().snapshot(source)

    const target = await freshRepo()
    await new BackupSerializer().restore(target, snap)

    // The line is observable only via getArchivedLinesForPgn after restore,
    // which is itself the proof that is_archived=1 survived the round-trip;
    // archived_at is observable on the returned entry.
    const archived = await target.getArchivedLinesForPgn(pgnId)
    expect(archived).toHaveLength(1)
    expect(archived[0].line.id).toBe(line.id)
    expect(archived[0].archived_at.toISOString()).toBe(archivedAt.toISOString())
  })

  it('round-trips the pgn author column', async () => {
    const source = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await source.savePgn({
      name: 'Test',
      result: { ...result, author: 'GM Annotator' },
    })

    const snap = await new BackupSerializer().snapshot(source)
    const target = await freshRepo()
    await new BackupSerializer().restore(target, snap)

    const [pgn] = await target.listPgns()
    expect(pgn.author).toBe('GM Annotator')
  })
})
