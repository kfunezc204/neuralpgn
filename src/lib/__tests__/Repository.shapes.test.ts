import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'

const SHAPES_PGN = `[Event "Test"]
[White "Shapes Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 {[%cal Gg1f3][%csl Yd4] desarrolla} Nc6 2. Bc4 *
`

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

async function seedShapesPgn(repo: Repository) {
  const result = new PgnIngestor().ingest(SHAPES_PGN)
  const pgnId = await repo.savePgn({ name: 'Con shapes', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  return chapter.id
}

describe('Repository — card shapes', () => {
  it('persists card shapes and returns them on load', async () => {
    const repo = await freshRepo()
    const chapterId = await seedShapesPgn(repo)

    const cards = await repo.getCardsForChapter(chapterId)

    const withShapes = cards.find((c) => c.shapes !== null)
    expect(withShapes?.shapes).toEqual([
      { brush: 'green', orig: 'g1', dest: 'f3' },
      { brush: 'yellow', orig: 'd4' },
    ])
    // Cards without annotations stay shape-less.
    expect(cards.some((c) => c.shapes === null)).toBe(true)
  })

  it('migration adds the shapes column to a pre-existing DB and is a no-op when re-run', async () => {
    const sql = openInMemoryAdapter()
    // v4 DB whose cards table predates the shapes column.
    await sql.execute(
      `CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    )
    await sql.execute(
      `INSERT INTO schema_meta (key, value) VALUES ('version', '4')`,
    )
    await sql.execute(`
      CREATE TABLE pgns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_path TEXT,
        author TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await sql.execute(`
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pgn_id INTEGER NOT NULL REFERENCES pgns(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        user_side TEXT NOT NULL,
        intro_comment TEXT
      )
    `)
    await sql.execute(`
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        fen_canonical TEXT NOT NULL,
        refutations TEXT NOT NULL DEFAULT '[]',
        comment TEXT,
        UNIQUE(chapter_id, fen_canonical)
      )
    `)

    const repo = new Repository(sql)
    await repo.migrate()
    await repo.migrate() // second run must be a clean no-op

    const chapterId = await seedShapesPgn(repo)
    const cards = await repo.getCardsForChapter(chapterId)
    expect(cards.some((c) => c.shapes !== null)).toBe(true)
  })

  it('backup/restore round-trip preserves card shapes', async () => {
    const source = await freshRepo()
    const chapterId = await seedShapesPgn(source)
    const snapshot = await source.dumpAll()

    const restored = await freshRepo()
    await restored.restoreAll(snapshot)

    const cards = await restored.getCardsForChapter(chapterId)
    const withShapes = cards.find((c) => c.shapes !== null)
    expect(withShapes?.shapes).toEqual([
      { brush: 'green', orig: 'g1', dest: 'f3' },
      { brush: 'yellow', orig: 'd4' },
    ])
  })

  it('restores a backup that predates the shapes column', async () => {
    const source = await freshRepo()
    const chapterId = await seedShapesPgn(source)
    const snapshot = await source.dumpAll()
    snapshot.cards = snapshot.cards.map((row) => {
      const { shapes: _omitted, ...rest } = row as Record<string, unknown>
      return rest
    })

    const restored = await freshRepo()
    await restored.restoreAll(snapshot)

    const cards = await restored.getCardsForChapter(chapterId)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((c) => c.shapes === null)).toBe(true)
  })
})
