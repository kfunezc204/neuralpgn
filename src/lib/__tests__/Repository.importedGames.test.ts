import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { Repository } from '../Repository.ts'
import type { NewImportedGame } from '../Repository.ts'

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

function game(overrides: Partial<NewImportedGame> = {}): NewImportedGame {
  return {
    dedupe_key: 'lichess:AbCdEfGh',
    source: 'lichess',
    site_url: 'https://lichess.org/AbCdEfGh',
    played_at: '2026-06-28T18:32:11.000Z',
    white: 'kevin204',
    black: 'rival77',
    user_color: 'white',
    result: '1-0',
    time_control: '300+0',
    sans: ['e4', 'e5', 'Nf3'],
    pgn_text: '[White "kevin204"]\n\n1. e4 e5 2. Nf3 1-0\n',
    ...overrides,
  }
}

describe('Repository — imported games', () => {
  it('saves games and lists them newest first with sans round-tripped', async () => {
    const repo = await freshRepo()

    const inserted = await repo.saveImportedGames([
      game(),
      game({
        dedupe_key: 'hash:zz12',
        source: 'pgn',
        site_url: null,
        played_at: '2026-06-29T10:00:00.000Z',
        user_color: 'black',
        time_control: null,
      }),
    ])

    expect(inserted).toBe(2)
    const rows = await repo.listImportedGames()
    expect(rows).toHaveLength(2)
    // Newest played_at first.
    expect(rows[0].dedupe_key).toBe('hash:zz12')
    expect(rows[0].user_color).toBe('black')
    expect(rows[0].time_control).toBe(null)
    expect(rows[1].sans).toEqual(['e4', 'e5', 'Nf3'])
    expect(rows[1].pgn_text).toContain('kevin204')
  })

  it('ignores duplicates by dedupe_key and reports only newly inserted games', async () => {
    const repo = await freshRepo()

    expect(await repo.saveImportedGames([game()])).toBe(1)
    // Re-import of the same game plus one genuinely new one.
    const inserted = await repo.saveImportedGames([
      game(),
      game({ dedupe_key: 'lichess:XyZw9876' }),
    ])

    expect(inserted).toBe(1)
    expect(await repo.listImportedGames()).toHaveLength(2)
  })

  it('survives a re-run of migrate without losing games', async () => {
    const repo = await freshRepo()
    await repo.saveImportedGames([game()])
    await repo.migrate()
    expect(await repo.listImportedGames()).toHaveLength(1)
  })
})
