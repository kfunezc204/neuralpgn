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

describe('Repository — restoreAll atomicity', () => {
  it('round-trips a dumpAll snapshot through restoreAll', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await repo.savePgn({ name: 'Original', result })
    const snap = await repo.dumpAll()

    const target = await freshRepo()
    await target.restoreAll(snap)
    const restored = await target.dumpAll()
    expect(restored).toEqual(snap)
  })

  it('a snapshot with an invalid row restores NOTHING and leaves existing data intact', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Keep me', result })

    // Valid snapshot, then poison one line_state row: 'bogus' violates the
    // CHECK(state IN (...)) constraint, which only fails once the restore is
    // already past the wipe and several tables of inserts.
    const snap = await repo.dumpAll()
    const poisoned = {
      ...snap,
      line_states: [
        {
          line_id: (snap.lines[0] as { id: number }).id,
          profile_id: 'default',
          stability: 1,
          difficulty: 5,
          due: '2025-01-01T00:00:00.000Z',
          state: 'bogus',
          reps: 1,
          lapses: 0,
          consecutive_correct: 0,
          learning_steps: 0,
          last_review: null,
        },
      ],
    }

    await expect(repo.restoreAll(poisoned)).rejects.toThrow()

    // The wipe must have rolled back too: the original course is untouched.
    const pgns = await repo.listPgns()
    expect(pgns).toHaveLength(1)
    expect(pgns[0].id).toBe(pgnId)
    expect(pgns[0].name).toBe('Keep me')
    const after = await repo.dumpAll()
    expect(after).toEqual(snap)
  })
})
