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

async function seed() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(LINEAR_PGN)
  const pgnId = await repo.savePgn({ name: 'PGN A', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const [line] = await repo.getLinesForChapter(chapter.id)
  const cards = await repo.getCardsForChapter(chapter.id)
  return { repo, pgnId, chapter, line, cards }
}

describe('Repository — move misses', () => {
  it('records and reads back misses for a pgn, with Date round-trip', async () => {
    const { repo, pgnId, line, cards } = await seed()
    const ts = new Date('2026-06-01T10:00:00.000Z')
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts,
        kind: 'retry',
        played_san: 'Bb5+',
        expected_san: null,
      },
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts,
        kind: 'double_fail',
        played_san: 'Bb5+',
        expected_san: 'Nf3',
      },
    ])

    const rows = await repo.getMoveMissesForPgn(pgnId)
    expect(rows).toHaveLength(2)
    expect(rows[0].kind).toBe('retry')
    expect(rows[0].expected_san).toBeNull()
    expect(rows[0].ts).toEqual(ts)
    expect(rows[1].kind).toBe('double_fail')
    expect(rows[1].expected_san).toBe('Nf3')
  })

  it('scopes misses by pgn and by profile', async () => {
    const { repo, pgnId, line, cards } = await seed()
    const otherResult = new PgnIngestor().ingest(LINEAR_PGN)
    const otherPgnId = await repo.savePgn({ name: 'PGN B', result: otherResult })

    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date(),
        kind: 'refutation',
        played_san: 'd4',
        expected_san: null,
      },
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date(),
        kind: 'retry',
        played_san: 'd4',
        expected_san: null,
        profile_id: 'alt',
      },
    ])

    expect(await repo.getMoveMissesForPgn(otherPgnId)).toHaveLength(0)
    expect(await repo.getMoveMissesForPgn(pgnId)).toHaveLength(1)
    expect(await repo.getMoveMissesForPgn(pgnId, 'alt')).toHaveLength(1)
  })

  it('hard-deleting a line removes its misses but keeps puzzle attempts (card-scoped)', async () => {
    const { repo, pgnId, line, cards } = await seed()
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date(),
        kind: 'double_fail',
        played_san: 'a3',
        expected_san: 'Nf3',
      },
    ])
    await repo.recordPuzzleAttempt({
      card_id: cards[0].id,
      ts: new Date(),
      correct: true,
    })

    await repo.archiveLine(line.id)
    await repo.deleteLineHard(line.id)

    expect(await repo.getMoveMissesForPgn(pgnId)).toHaveLength(0)
    expect(await repo.getPuzzleAttemptsForPgn(pgnId)).toHaveLength(1)
  })

  it('deleting the pgn cascades both misses and attempts away', async () => {
    const { repo, pgnId, line, cards } = await seed()
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date(),
        kind: 'retry',
        played_san: 'a3',
        expected_san: null,
      },
    ])
    await repo.recordPuzzleAttempt({
      card_id: cards[0].id,
      ts: new Date(),
      correct: false,
    })

    await repo.deletePgn(pgnId)

    const dump = await repo.dumpAll()
    expect(dump.move_misses).toHaveLength(0)
    expect(dump.puzzle_attempts).toHaveLength(0)
  })
})

describe('Repository — puzzle attempts', () => {
  it('records and reads back attempts with boolean round-trip', async () => {
    const { repo, pgnId, cards } = await seed()
    await repo.recordPuzzleAttempt({
      card_id: cards[0].id,
      ts: new Date('2026-06-01T10:00:00.000Z'),
      correct: true,
    })
    await repo.recordPuzzleAttempt({
      card_id: cards[0].id,
      ts: new Date('2026-06-01T11:00:00.000Z'),
      correct: false,
    })

    const rows = await repo.getPuzzleAttemptsForPgn(pgnId)
    expect(rows).toHaveLength(2)
    expect(rows[0].correct).toBe(true)
    expect(rows[1].correct).toBe(false)
    expect(rows[0].ts).toEqual(new Date('2026-06-01T10:00:00.000Z'))
  })
})

describe('BackupSerializer — weak-point tables', () => {
  it('round-trips misses and attempts through snapshot/restore', async () => {
    const { repo, pgnId, line, cards } = await seed()
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date('2026-06-01T10:00:00.000Z'),
        kind: 'double_fail',
        played_san: 'Bb5+',
        expected_san: 'Nf3',
      },
    ])
    await repo.recordPuzzleAttempt({
      card_id: cards[0].id,
      ts: new Date('2026-06-02T10:00:00.000Z'),
      correct: true,
    })

    const serializer = new BackupSerializer()
    const snap = await serializer.snapshot(repo)
    expect(snap.version).toBe(3)

    const target = new Repository(openInMemoryAdapter())
    await target.migrate()
    await serializer.restore(target, snap)

    const misses = await target.getMoveMissesForPgn(pgnId)
    expect(misses).toHaveLength(1)
    expect(misses[0].played_san).toBe('Bb5+')
    expect(await target.getPuzzleAttemptsForPgn(pgnId)).toHaveLength(1)
  })

  it('still restores a legacy v2 backup (without weak-point tables)', async () => {
    const { repo, pgnId } = await seed()
    const serializer = new BackupSerializer()
    const snap = await serializer.snapshot(repo)
    const legacy = { ...snap, version: 2 }
    delete (legacy as { move_misses?: unknown[] }).move_misses
    delete (legacy as { puzzle_attempts?: unknown[] }).puzzle_attempts

    const target = new Repository(openInMemoryAdapter())
    await target.migrate()
    await serializer.restore(target, legacy)

    expect((await target.listPgns()).map((p) => p.id)).toContain(pgnId)
    expect(await target.getMoveMissesForPgn(pgnId)).toHaveLength(0)
  })

  it('rejects unknown backup versions', async () => {
    const { repo } = await seed()
    const serializer = new BackupSerializer()
    const snap = await serializer.snapshot(repo)

    const target = new Repository(openInMemoryAdapter())
    await target.migrate()
    await expect(
      serializer.restore(target, { ...snap, version: 99 }),
    ).rejects.toThrow(/Unsupported backup version/)
  })
})
