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

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

describe('Repository — challenge flag', () => {
  it('persists the challenge flag on save and reports it in listPgns', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)

    const challengeId = await repo.savePgn({
      name: 'Woodpecker',
      result,
      is_challenge: true,
    })
    const studyId = await repo.savePgn({ name: 'Repertorio', result })

    const pgns = await repo.listPgns()
    expect(pgns.find((p) => p.id === challengeId)?.is_challenge).toBe(true)
    expect(pgns.find((p) => p.id === studyId)?.is_challenge).toBe(false)
  })

  it('migration adds the flag to a pre-existing DB (old courses stay study courses)', async () => {
    const sql = openInMemoryAdapter()
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
    await sql.execute(`INSERT INTO pgns (name) VALUES ('Curso viejo')`)

    const repo = new Repository(sql)
    await repo.migrate()
    await repo.migrate() // no-op on an already-migrated DB

    const [old] = await repo.listPgns()
    expect(old.is_challenge).toBe(false)
  })

  it('backup/restore round-trip preserves the flag; old backups restore as study courses', async () => {
    const source = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await source.savePgn({ name: 'Woodpecker', result, is_challenge: true })
    const snapshot = await source.dumpAll()

    const restored = await freshRepo()
    await restored.restoreAll(snapshot)
    const [pgn] = await restored.listPgns()
    expect(pgn.is_challenge).toBe(true)

    // Backup predating the column: field absent from rows.
    snapshot.pgns = snapshot.pgns.map((row) => {
      const { is_challenge: _omitted, ...rest } = row as Record<string, unknown>
      return rest
    })
    const restoredOld = await freshRepo()
    await restoredOld.restoreAll(snapshot)
    const [oldPgn] = await restoredOld.listPgns()
    expect(oldPgn.is_challenge).toBe(false)
  })

  it('setChallengeMode flips the flag on and off after import', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Pack', result })

    await repo.setChallengeMode(pgnId, true)
    expect((await repo.listPgns())[0].is_challenge).toBe(true)

    await repo.setChallengeMode(pgnId, false)
    expect((await repo.listPgns())[0].is_challenge).toBe(false)
  })

  it('setChallengeMode rejects a pgn that does not exist', async () => {
    const repo = await freshRepo()
    await expect(repo.setChallengeMode(99999, true)).rejects.toThrow()
  })
})
