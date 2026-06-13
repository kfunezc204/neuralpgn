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

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

async function seedMulti() {
  const repo = await freshRepo()
  const result = new PgnIngestor().ingest(MULTI_LINE_PGN)
  const pgnId = await repo.savePgn({ name: 'Multi', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const lines = await repo.getLinesForChapter(chapter.id)
  return { repo, chapter, lines }
}

describe('Repository.archiveLines (bulk)', () => {
  it('archives every id passed in a single call, removing them all from getLinesForChapter', async () => {
    const { repo, chapter, lines } = await seedMulti()
    expect(lines.length).toBeGreaterThanOrEqual(3)
    const targets = [lines[0].id, lines[1].id, lines[2].id]

    await repo.archiveLines(targets)

    const remaining = await repo.getLinesForChapter(chapter.id)
    const remainingIds = remaining.map((l) => l.id)
    for (const id of targets) {
      expect(remainingIds).not.toContain(id)
    }
  })

  it('archiveLines([]) is a no-op and does not touch any line', async () => {
    const { repo, chapter, lines } = await seedMulti()
    const before = await repo.getLinesForChapter(chapter.id)

    await repo.archiveLines([])

    const after = await repo.getLinesForChapter(chapter.id)
    expect(after.map((l) => l.id)).toEqual(before.map((l) => l.id))
    expect(after.length).toBe(lines.length)
  })

  it('stamps every archived line with the same archived_at so the bulk batch appears together in Archivo (most-recent-first)', async () => {
    const { repo, lines } = await seedMulti()
    // Archive an early line on a much-earlier date so we can tell apart.
    const old = new Date('2024-01-01T00:00:00Z')
    await repo.archiveLine(lines[0].id, old)

    const bulkTs = new Date('2025-06-15T12:34:56Z')
    await repo.archiveLines([lines[1].id, lines[2].id], bulkTs)

    const archived = await repo.getArchivedLinesForPgn(
      (await repo.listPgns())[0].id,
    )
    const byId = new Map(archived.map((a) => [a.line.id, a.archived_at]))
    expect(byId.get(lines[1].id)!.toISOString()).toBe(bulkTs.toISOString())
    expect(byId.get(lines[2].id)!.toISOString()).toBe(bulkTs.toISOString())
    expect(byId.get(lines[0].id)!.toISOString()).toBe(old.toISOString())
  })
})
