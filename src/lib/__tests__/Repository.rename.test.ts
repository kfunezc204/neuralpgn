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

async function seedPgn() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(LINEAR_PGN)
  const pgnId = await repo.savePgn({ name: 'Nombre feo importado', result })
  return { repo, pgnId }
}

describe('Repository — renamePgn', () => {
  it('renames a course and the new name is what listPgns reports', async () => {
    const { repo, pgnId } = await seedPgn()

    await repo.renamePgn(pgnId, 'Escocesa GM Avetik')

    const [pgn] = await repo.listPgns()
    expect(pgn.id).toBe(pgnId)
    expect(pgn.name).toBe('Escocesa GM Avetik')
  })

  it('rejects an empty or whitespace-only name and keeps the current one', async () => {
    const { repo, pgnId } = await seedPgn()

    await expect(repo.renamePgn(pgnId, '   ')).rejects.toThrow()

    const [pgn] = await repo.listPgns()
    expect(pgn.name).toBe('Nombre feo importado')
  })

  it('trims surrounding whitespace before persisting', async () => {
    const { repo, pgnId } = await seedPgn()

    await repo.renamePgn(pgnId, '  Repertorio Negras  ')

    const [pgn] = await repo.listPgns()
    expect(pgn.name).toBe('Repertorio Negras')
  })

  it('rejects renaming a pgn that does not exist', async () => {
    const { repo } = await seedPgn()

    await expect(repo.renamePgn(99999, 'Lo que sea')).rejects.toThrow()
  })
})
