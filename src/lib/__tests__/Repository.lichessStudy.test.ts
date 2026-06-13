import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'

const LINEAR_PGN = `[Event "Repertorio Escocesa: Capítulo 1"]
[White "?"]
[Black "?"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 *
`

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

describe('Repository — Lichess study ID', () => {
  it('persists the study ID on save and finds the course by it', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)

    const pgnId = await repo.savePgn({
      name: 'Repertorio Escocesa',
      result,
      lichess_study_id: 'AbCd1234',
    })

    const found = await repo.findPgnByLichessStudyId('AbCd1234')
    expect(found).toMatchObject({ id: pgnId, name: 'Repertorio Escocesa' })
  })

  it('file imports save without a study ID and are not duplicate candidates', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)

    await repo.savePgn({ name: 'Desde archivo', result })

    expect(await repo.findPgnByLichessStudyId('AbCd1234')).toBeNull()
  })

  it('migration adds the column to a pre-existing v4 DB without the column', async () => {
    const sql = openInMemoryAdapter()
    // Simulate a DB created before the lichess_study_id column existed:
    // schema_meta already at v4 (so migrate() won't nuke) and a pgns table
    // lacking the new column.
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

    // Old rows survive with a NULL study ID; new saves can use the column.
    expect(await repo.findPgnByLichessStudyId('AbCd1234')).toBeNull()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await repo.savePgn({
      name: 'Nuevo',
      result,
      lichess_study_id: 'AbCd1234',
    })
    expect(await repo.findPgnByLichessStudyId('AbCd1234')).not.toBeNull()
    const [oldCourse] = await sql.select<{ lichess_study_id: string | null }>(
      `SELECT lichess_study_id FROM pgns WHERE name = 'Curso viejo'`,
    )
    expect(oldCourse.lichess_study_id).toBeNull()
  })

  it('migration is a no-op on an already-migrated DB', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({
      name: 'Repertorio',
      result,
      lichess_study_id: 'AbCd1234',
    })

    await repo.migrate()

    // Data and column intact after a second migrate.
    expect(await repo.findPgnByLichessStudyId('AbCd1234')).toMatchObject({
      id: pgnId,
    })
  })

  it('backup/restore round-trip preserves the study ID', async () => {
    const source = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await source.savePgn({
      name: 'Repertorio Escocesa',
      result,
      lichess_study_id: 'AbCd1234',
    })
    const snapshot = await source.dumpAll()

    const restored = await freshRepo()
    await restored.restoreAll(snapshot)

    expect(await restored.findPgnByLichessStudyId('AbCd1234')).toMatchObject({
      name: 'Repertorio Escocesa',
    })
  })

  it('restores a backup that predates the study ID column', async () => {
    const source = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await source.savePgn({ name: 'Curso viejo', result })
    const snapshot = await source.dumpAll()
    // Simulate an old backup: rows without the lichess_study_id field.
    snapshot.pgns = snapshot.pgns.map((row) => {
      const { lichess_study_id: _omitted, ...rest } = row as Record<
        string,
        unknown
      >
      return rest
    })

    const restored = await freshRepo()
    await restored.restoreAll(snapshot)

    const [pgn] = await restored.listPgns()
    expect(pgn.name).toBe('Curso viejo')
  })
})
