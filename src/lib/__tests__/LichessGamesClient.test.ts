import { describe, it, expect } from 'vitest'
import { fetchUserGames, GamesDownloadError } from '../LichessGamesClient.ts'
import type { GamesFetch } from '../LichessGamesClient.ts'

const GAMES_PGN = `[Event "Rated blitz game"]
[Site "https://lichess.org/AbCdEfGh"]
[White "kevin204"]
[Black "rival77"]
[Result "1-0"]

1. e4 e5 1-0
`

function fakeFetch(
  responses: Record<string, { status: number; body?: string }>,
): { fetch: GamesFetch; requested: string[] } {
  const requested: string[] = []
  const fetch: GamesFetch = async (url) => {
    requested.push(url)
    const r = responses[url]
    if (!r) throw new Error(`unexpected URL ${url}`)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body ?? '',
    }
  }
  return { fetch, requested }
}

describe('LichessGamesClient', () => {
  it('downloads standard-chess games with max on the first sync', async () => {
    const url =
      'https://lichess.org/api/games/user/kevin204?max=100&perfType=ultraBullet%2Cbullet%2Cblitz%2Crapid%2Cclassical%2Ccorrespondence'
    const { fetch, requested } = fakeFetch({
      [url]: { status: 200, body: GAMES_PGN },
    })

    const pgn = await fetchUserGames('kevin204', {}, fetch)

    expect(requested).toEqual([url])
    expect(pgn).toBe(GAMES_PGN)
  })

  it('passes since as epoch millis on incremental syncs', async () => {
    const since = new Date('2026-07-01T00:00:00.000Z')
    const url = `https://lichess.org/api/games/user/kevin204?max=100&perfType=ultraBullet%2Cbullet%2Cblitz%2Crapid%2Cclassical%2Ccorrespondence&since=${since.getTime()}`
    const { fetch, requested } = fakeFetch({
      [url]: { status: 200, body: GAMES_PGN },
    })

    await fetchUserGames('kevin204', { since }, fetch)

    expect(requested).toEqual([url])
  })

  it('maps 404 to user-not-found and 429 to rate-limited', async () => {
    const base =
      'https://lichess.org/api/games/user/ghost?max=100&perfType=ultraBullet%2Cbullet%2Cblitz%2Crapid%2Cclassical%2Ccorrespondence'
    const notFound = fakeFetch({ [base]: { status: 404 } })
    await expect(
      fetchUserGames('ghost', {}, notFound.fetch),
    ).rejects.toMatchObject({ kind: 'user-not-found' })

    const limited = fakeFetch({ [base]: { status: 429 } })
    await expect(
      fetchUserGames('ghost', {}, limited.fetch),
    ).rejects.toMatchObject({ kind: 'rate-limited' })
  })

  it('wraps fetch failures as network errors', async () => {
    const err = await fetchUserGames('kevin204', {}, async () => {
      throw new Error('offline')
    }).catch((e) => e)

    expect(err).toBeInstanceOf(GamesDownloadError)
    expect(err.kind).toBe('network')
  })
})
