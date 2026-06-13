/**
 * Downloads a public Lichess study as PGN via the public API.
 * The fetch function is injected so the client is testable without network;
 * production callers pass the webview's `fetch` (Lichess supports CORS).
 */

/** Structural subset of the platform Response that the client needs. */
export interface StudyResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type StudyFetch = (url: string) => Promise<StudyResponse>

export interface StudyDownload {
  pgnText: string
  studyName: string
}

export type StudyErrorKind =
  | 'not-found-or-private'
  | 'export-disabled'
  | 'rate-limited'
  | 'network'
  | 'unexpected'

export class StudyDownloadError extends Error {
  constructor(
    readonly kind: StudyErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'StudyDownloadError'
  }
}

export async function fetchStudy(
  studyId: string,
  fetchFn: StudyFetch,
): Promise<StudyDownload> {
  let response: StudyResponse
  try {
    response = await fetchFn(`https://lichess.org/api/study/${studyId}.pgn`)
  } catch (err) {
    throw new StudyDownloadError(
      'network',
      err instanceof Error ? err.message : String(err),
    )
  }
  if (response.status === 404) {
    throw new StudyDownloadError(
      'not-found-or-private',
      `study ${studyId} not found or private`,
    )
  }
  // Public studies whose owner turned off "Share PGN" export with a 403.
  if (response.status === 403) {
    throw new StudyDownloadError(
      'export-disabled',
      `study ${studyId} has PGN export disabled by its owner`,
    )
  }
  if (response.status === 429) {
    throw new StudyDownloadError('rate-limited', 'Lichess rate limit hit')
  }
  if (!response.ok) {
    throw new StudyDownloadError(
      'unexpected',
      `unexpected HTTP ${response.status} from Lichess`,
    )
  }
  const pgnText = await response.text()
  return { pgnText, studyName: extractStudyName(pgnText, studyId) }
}

// Lichess exports carry an explicit [StudyName "..."] header per game. Fall
// back to [Event "StudyName: ChapterName"] split at the first ": " (older
// export shape), then to the study ID.
function extractStudyName(pgnText: string, fallback: string): string {
  const studyName = /\[StudyName\s+"([^"]*)"\]/.exec(pgnText)?.[1]
  if (studyName) return studyName
  const event = /\[Event\s+"([^"]*)"\]/.exec(pgnText)?.[1]
  if (!event) return fallback
  const sep = event.indexOf(': ')
  return sep === -1 ? event : event.slice(0, sep)
}
