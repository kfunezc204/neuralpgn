import { describe, it, expect } from 'vitest'
import { fetchStudy } from '../LichessStudyClient.ts'
import type { StudyFetch } from '../LichessStudyClient.ts'

const STUDY_PGN = `[Event "Repertorio Escocesa: Capítulo 1"]
[Site "https://lichess.org/study/AbCd1234/xYzW5678"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 *

[Event "Repertorio Escocesa: Capítulo 2"]
[Site "https://lichess.org/study/AbCd1234/qRsT9012"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 *
`

function fakeFetch(
  responses: Record<string, { status: number; body?: string }>,
): { fetch: StudyFetch; requested: string[] } {
  const requested: string[] = []
  const fetch: StudyFetch = async (url) => {
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

describe('LichessStudyClient', () => {
  it('downloads the study PGN and derives the study name from the first Event header', async () => {
    const { fetch, requested } = fakeFetch({
      'https://lichess.org/api/study/AbCd1234.pgn': {
        status: 200,
        body: STUDY_PGN,
      },
    })

    const result = await fetchStudy('AbCd1234', fetch)

    expect(requested).toEqual(['https://lichess.org/api/study/AbCd1234.pgn'])
    expect(result.pgnText).toBe(STUDY_PGN)
    expect(result.studyName).toBe('Repertorio Escocesa')
  })

  it('prefers the StudyName header over splitting Event, so names with ": " survive', async () => {
    const pgn = `[Event "Apertura: Italiana: Capítulo 1"]
[StudyName "Apertura: Italiana"]
[ChapterName "Capítulo 1"]
[Result "*"]

1. e4 e5 *
`
    const { fetch } = fakeFetch({
      'https://lichess.org/api/study/AbCd1234.pgn': { status: 200, body: pgn },
    })

    const result = await fetchStudy('AbCd1234', fetch)

    expect(result.studyName).toBe('Apertura: Italiana')
  })

  it('maps a 404 to a not-found-or-private typed error', async () => {
    const { fetch } = fakeFetch({
      'https://lichess.org/api/study/AbCd1234.pgn': { status: 404 },
    })

    await expect(fetchStudy('AbCd1234', fetch)).rejects.toMatchObject({
      kind: 'not-found-or-private',
    })
  })

  it('maps a 429 to a rate-limited typed error', async () => {
    const { fetch } = fakeFetch({
      'https://lichess.org/api/study/AbCd1234.pgn': { status: 429 },
    })

    await expect(fetchStudy('AbCd1234', fetch)).rejects.toMatchObject({
      kind: 'rate-limited',
    })
  })

  it('maps a thrown fetch (no connection) to a network typed error', async () => {
    const failingFetch = async () => {
      throw new TypeError('Failed to fetch')
    }

    await expect(fetchStudy('AbCd1234', failingFetch)).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('maps a 403 (owner disabled PGN export) to its own typed error', async () => {
    const { fetch } = fakeFetch({
      'https://lichess.org/api/study/AbCd1234.pgn': { status: 403 },
    })

    await expect(fetchStudy('AbCd1234', fetch)).rejects.toMatchObject({
      kind: 'export-disabled',
    })
  })

  it('maps any other non-OK status to an unexpected typed error', async () => {
    const { fetch } = fakeFetch({
      'https://lichess.org/api/study/AbCd1234.pgn': { status: 500 },
    })

    await expect(fetchStudy('AbCd1234', fetch)).rejects.toMatchObject({
      kind: 'unexpected',
    })
  })
})
