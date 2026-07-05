import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'
import type { NewImportedGame } from '../Repository.ts'
import type { SqlAdapter } from '../SqlAdapter.ts'

const LINEAR_PGN = `[Event "Repertoire"]
[White "White Repertoire"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

function importedGame(
  overrides: Partial<NewImportedGame> = {},
): NewImportedGame {
  return {
    dedupe_key: 'lichess:AbCdEfGh',
    source: 'lichess',
    site_url: null,
    played_at: '2026-06-28T18:32:11.000Z',
    white: 'kevin204',
    black: 'rival77',
    user_color: 'white',
    result: '1-0',
    time_control: '300+0',
    sans: ['e4', 'e5', 'Bc4'],
    pgn_text: '1. e4 e5 2. Bc4 1-0\n',
    ...overrides,
  }
}

async function seed(sql: SqlAdapter = openInMemoryAdapter()) {
  const repo = new Repository(sql)
  await repo.migrate()
  const result = new PgnIngestor().ingest(LINEAR_PGN)
  const pgnId = await repo.savePgn({ name: 'Course', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const [line] = await repo.getLinesForChapter(chapter.id)
  const cards = await repo.getCardsForChapter(chapter.id)
  await repo.saveImportedGames([importedGame()])
  const [game] = await repo.listImportedGames()
  return { sql, repo, pgnId, line, cards, game }
}

describe('Repository — game_deviation misses', () => {
  it('records and reads back a game_deviation miss', async () => {
    const { repo, pgnId, line, cards } = await seed()
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date('2026-06-28T19:00:00.000Z'),
        kind: 'game_deviation',
        played_san: 'Bc4',
        expected_san: 'Nf3',
      },
    ])

    const rows = await repo.getMoveMissesForPgn(pgnId)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('game_deviation')
  })

  it('upgrades a legacy move_misses CHECK constraint without losing rows', async () => {
    const { sql, repo, pgnId, line, cards } = await seed()
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date('2026-06-01T10:00:00.000Z'),
        kind: 'retry',
        played_san: 'a3',
        expected_san: null,
      },
    ])

    // Simulate a DB created before the game_deviation kind existed: rebuild
    // the table with the old three-kind CHECK, keeping the row.
    await sql.execute(`ALTER TABLE move_misses RENAME TO mm_old`)
    await sql.execute(`
      CREATE TABLE move_misses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL DEFAULT 'default',
        ts TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('retry','double_fail','refutation')),
        played_san TEXT NOT NULL,
        expected_san TEXT
      )
    `)
    await sql.execute(`INSERT INTO move_misses SELECT * FROM mm_old`)
    await sql.execute(`DROP TABLE mm_old`)

    await repo.migrate()

    // Old row survived and the new kind is accepted now.
    expect(await repo.getMoveMissesForPgn(pgnId)).toHaveLength(1)
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date('2026-06-28T19:00:00.000Z'),
        kind: 'game_deviation',
        played_san: 'Bc4',
        expected_san: 'Nf3',
      },
    ])
    expect(await repo.getMoveMissesForPgn(pgnId)).toHaveLength(2)
  })
})

describe('Repository — deviation actions', () => {
  it('records an action once and reports repeats as not-new (idempotent Drill)', async () => {
    const { repo, cards, game } = await seed()

    const first = await repo.recordDeviationAction({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })
    const second = await repo.recordDeviationAction({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
    const actions = await repo.listDeviationActions()
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })
  })

  it('keys actions by game + card + played move: same card in another game is separate', async () => {
    const { repo, cards, game } = await seed()
    await repo.saveImportedGames([
      importedGame({ dedupe_key: 'lichess:XyZw9876' }),
    ])
    const games = await repo.listImportedGames()
    const other = games.find((g) => g.id !== game.id)!

    await repo.recordDeviationAction({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'dismissed',
    })
    const secondGame = await repo.recordDeviationAction({
      game_id: other.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'dismissed',
    })

    expect(secondGame).toBe(true)
    expect(await repo.listDeviationActions()).toHaveLength(2)
  })

  it('leaves FSRS line state byte-identical when a deviation is drilled', async () => {
    const { repo, pgnId, line, cards, game } = await seed()
    await repo.saveLineState(line.id, {
      stability: 12.5,
      difficulty: 4.2,
      due: new Date('2026-07-10T00:00:00.000Z'),
      state: 'review',
      reps: 7,
      lapses: 1,
      consecutive_correct: 3,
      learning_steps: 0,
      last_review: new Date('2026-06-30T00:00:00.000Z'),
    })
    const before = await repo.getLineStatesForPgn(pgnId)

    await repo.recordDeviationAction({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })
    await repo.recordMoveMisses([
      {
        card_id: cards[0].id,
        line_id: line.id,
        ts: new Date(),
        kind: 'game_deviation',
        played_san: 'Bc4',
        expected_san: 'Nf3',
      },
    ])

    expect(await repo.getLineStatesForPgn(pgnId)).toEqual(before)
  })

  it('deletes a single imported game and cascades its actions, leaving others intact', async () => {
    const { repo, cards, game } = await seed()
    await repo.saveImportedGames([
      importedGame({ dedupe_key: 'lichess:XyZw9876' }),
    ])
    const games = await repo.listImportedGames()
    const other = games.find((g) => g.id !== game.id)!
    await repo.recordDeviationAction({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })
    await repo.recordDeviationAction({
      game_id: other.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'dismissed',
    })

    await repo.deleteImportedGame(game.id)

    const remaining = await repo.listImportedGames()
    expect(remaining.map((g) => g.id)).toEqual([other.id])
    const actions = await repo.listDeviationActions()
    expect(actions).toHaveLength(1)
    expect(actions[0].game_id).toBe(other.id)
  })

  it('bulk-deletes several imported games in one call, cascading their actions', async () => {
    const { repo, cards, game } = await seed()
    await repo.saveImportedGames([
      importedGame({ dedupe_key: 'lichess:XyZw9876' }),
      importedGame({ dedupe_key: 'lichess:QqWwEeRr' }),
    ])
    const games = await repo.listImportedGames()
    expect(games).toHaveLength(3)
    const [a, b] = games.filter((g) => g.id !== game.id)
    await repo.recordDeviationAction({
      game_id: a.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })

    await repo.deleteImportedGames([a.id, b.id])

    const remaining = await repo.listImportedGames()
    expect(remaining.map((g) => g.id)).toEqual([game.id])
    expect(await repo.listDeviationActions()).toHaveLength(0)
  })

  it('cascades actions away with their game and with their card’s course', async () => {
    const { repo, pgnId, cards, game } = await seed()
    await repo.recordDeviationAction({
      game_id: game.id,
      card_id: cards[0].id,
      played_san: 'Bc4',
      action: 'sent',
    })

    await repo.deletePgn(pgnId)
    expect(await repo.listDeviationActions()).toHaveLength(0)
  })
})
