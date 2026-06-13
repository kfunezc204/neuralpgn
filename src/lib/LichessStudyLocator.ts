/**
 * Resolves the text a user pasted into a Lichess study ID, with no network.
 * Accepted inputs grow over the import phases: study URL, chapter URL,
 * scheme/www-less URLs, or the bare 8-character ID.
 */
export type LocateStudyResult =
  | { ok: true; studyId: string }
  | { ok: false; error: 'invalid' }

const STUDY_URL =
  /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/study\/([A-Za-z0-9]{8})(\/[A-Za-z0-9]{8})?$/

const BARE_ID = /^[A-Za-z0-9]{8}$/

export function locateStudy(input: string): LocateStudyResult {
  const trimmed = input.trim()
  if (BARE_ID.test(trimmed)) return { ok: true, studyId: trimmed }
  const match = STUDY_URL.exec(trimmed)
  if (match) return { ok: true, studyId: match[1] }
  return { ok: false, error: 'invalid' }
}
