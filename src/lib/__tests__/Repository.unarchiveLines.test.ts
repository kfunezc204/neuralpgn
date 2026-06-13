import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'

const MULTI_LINE_PGN = `[Event "Multi"]
[White "Chapter X"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4) (1. c4) (1. Nf3) *
`

async function seedAndArchive() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(MULTI_LINE_PGN)
  const pgnId = await repo.savePgn({ name: 'Multi', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const lines = await repo.getLinesForChapter(chapter.id)
  const archived = [lines[0].id, lines[1].id, lines[2].id]
  await repo.archiveLines(archived)
  return { repo, pgnId, chapter, lines, archived }
}

describe('Repository.unarchiveLines (bulk)', () => {
  it('restores every id passed in a single call so they all come back to getLinesForChapter', async () => {
    const { repo, chapter, archived } = await seedAndArchive()

    await repo.unarchiveLines(archived)

    const after = await repo.getLinesForChapter(chapter.id)
    const ids = after.map((l) => l.id)
    for (const id of archived) {
      expect(ids).toContain(id)
    }
  })

  it('unarchiveLines([]) is a no-op and leaves the archive listing untouched', async () => {
    const { repo, pgnId, archived } = await seedAndArchive()
    const before = await repo.getArchivedLinesForPgn(pgnId)
    expect(before.map((e) => e.line.id).sort()).toEqual([...archived].sort())

    await repo.unarchiveLines([])

    const after = await repo.getArchivedLinesForPgn(pgnId)
    expect(after.map((e) => e.line.id).sort()).toEqual([...archived].sort())
  })
})
