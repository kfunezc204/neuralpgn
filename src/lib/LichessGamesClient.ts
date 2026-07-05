/**
 * Downloads a user's played games from the public Lichess API as PGN.
 * Mirror of LichessStudyClient: fetch is injected for testability, errors
 * are typed so the view can show actionable messages.
 *
 * Standard chess only: perfType lists every standard-time-control perf and
 * omits variant perfs (chess960, atomic, …). GamePgnParser's is_standard
 * check remains as the second line of defense.
 */

/** Structural subset of the platform Response that the client needs. */
export interface GamesResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type GamesFetch = (url: string) => Promise<GamesResponse>

export type GamesErrorKind =
  | 'user-not-found'
  | 'rate-limited'
  | 'network'
  | 'unexpected'

export class GamesDownloadError extends Error {
  constructor(
    readonly kind: GamesErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'GamesDownloadError'
  }
}

export interface FetchUserGamesOptions {
  /** First sync omits it; incremental syncs pass the last sync time. */
  since?: Date
  /** Defaults to 100 — the agreed first-sync window. */
  max?: number
}

const STANDARD_PERFS = [
  'ultraBullet',
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
].join(',')

export async function fetchUserGames(
  username: string,
  opts: FetchUserGamesOptions,
  fetchFn: GamesFetch,
): Promise<string> {
  const params = new URLSearchParams()
  params.set('max', String(opts.max ?? 100))
  params.set('perfType', STANDARD_PERFS)
  if (opts.since) params.set('since', String(opts.since.getTime()))
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(
    username.trim(),
  )}?${params.toString()}`

  let response: GamesResponse
  try {
    response = await fetchFn(url)
  } catch (err) {
    throw new GamesDownloadError(
      'network',
      err instanceof Error ? err.message : String(err),
    )
  }
  if (response.status === 404) {
    throw new GamesDownloadError(
      'user-not-found',
      `Lichess user ${username} not found`,
    )
  }
  if (response.status === 429) {
    throw new GamesDownloadError('rate-limited', 'Lichess rate limit hit')
  }
  if (!response.ok) {
    throw new GamesDownloadError(
      'unexpected',
      `unexpected HTTP ${response.status} from Lichess`,
    )
  }
  return response.text()
}
