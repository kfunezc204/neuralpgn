import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { PgnIngestor } from '../lib/PgnIngestor.ts'
import { shouldPreselectChallenge } from '../lib/ChallengeHeuristic.ts'
import { locateStudy } from '../lib/LichessStudyLocator.ts'
import { fetchStudy, StudyDownloadError } from '../lib/LichessStudyClient.ts'
import { PgnDropZone } from '../components/PgnDropZone.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import type { IngestResult, UserSide } from '../lib/types.ts'

interface PreviewState {
  /** Course name proposal: file name for files, study name for Lichess. */
  fileName: string
  /** What to record as source_path: file name or the study URL. */
  sourcePath: string
  /** Set when the PGN came from a Lichess study; persisted with the course. */
  lichessStudyId?: string
  /** Raw PGN text, kept so confirm can re-ingest with the chosen sides. */
  text: string
  result: IngestResult
  initialPosChapterNames: Set<string>
}

/** A finished download held back because the study is already in the library. */
interface DuplicateWarning {
  existingCourseName: string
  studyId: string
  studyName: string
  pgnText: string
}

function describeStudyError(err: unknown): string {
  if (err instanceof StudyDownloadError) {
    switch (err.kind) {
      case 'not-found-or-private':
        return 'That study does not exist or is private. Only public studies can be imported.'
      case 'export-disabled':
        return 'The author of that study disabled PGN export, so it cannot be imported.'
      case 'rate-limited':
        return 'Lichess is rate-limiting requests. Wait a moment and try again.'
      case 'network':
        return 'Could not connect to Lichess. Check your connection and retry.'
      case 'unexpected':
        return 'Lichess returned something unexpected. Try again in a while.'
    }
  }
  return err instanceof Error ? err.message : String(err)
}

export function ImportView() {
  const repo = useRepository()
  const navigate = useNavigate()
  const location = useLocation()
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [overrides, setOverrides] = useState<Record<string, UserSide>>({})
  const [saving, setSaving] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [studyUrl, setStudyUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [studyError, setStudyError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateWarning | null>(null)
  const [isChallenge, setIsChallenge] = useState(false)
  // Guards against state updates if the user leaves mid-download.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  function loadPreview(
    fileName: string,
    text: string,
    origin?: { sourcePath: string; lichessStudyId: string },
  ) {
    setParseError(null)
    try {
      const initialPos = new Set<string>()
      const result = new PgnIngestor().ingest(text, {
        resolveStartingSide: (p) => {
          initialPos.add(p.name)
          return 'white'
        },
      })
      setPreview({
        fileName,
        sourcePath: origin?.sourcePath ?? fileName,
        lichessStudyId: origin?.lichessStudyId,
        text,
        result,
        initialPosChapterNames: initialPos,
      })
      setOverrides({})
      // Heuristic proposes, the user disposes: all-stm smells like tactics.
      setIsChallenge(shouldPreselectChallenge(result.chapters))
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    loadPreview(file.name, await file.text())
  }

  // A .pgn dropped on the library arrives via navigation state; consume it
  // once so a refresh doesn't replay the import preview.
  useEffect(() => {
    const dropped = (
      location.state as { droppedFile?: { name: string; text: string } } | null
    )?.droppedFile
    if (!dropped) return
    loadPreview(dropped.name, dropped.text)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  async function handleStudyImport() {
    const located = locateStudy(studyUrl)
    if (!located.ok) {
      setStudyError('That URL does not look like a Lichess study.')
      return
    }
    setStudyError(null)
    setDownloading(true)
    try {
      const study = await fetchStudy(located.studyId, (url) => fetch(url))
      if (!alive.current) return
      // Same study already in the library? Warn before showing the preview;
      // the user decides between a fresh duplicate course and cancelling.
      const existing = await repo.findPgnByLichessStudyId(located.studyId)
      if (!alive.current) return
      if (existing) {
        setDuplicate({
          existingCourseName: existing.name,
          studyId: located.studyId,
          studyName: study.studyName,
          pgnText: study.pgnText,
        })
        return
      }
      openStudyPreview(located.studyId, study.studyName, study.pgnText)
    } catch (err) {
      if (!alive.current) return
      setStudyError(describeStudyError(err))
    } finally {
      if (alive.current) setDownloading(false)
    }
  }

  function openStudyPreview(studyId: string, studyName: string, pgn: string) {
    loadPreview(studyName, pgn, {
      sourcePath: `https://lichess.org/study/${studyId}`,
      lichessStudyId: studyId,
    })
  }

  async function handleConfirm() {
    if (!preview) return
    setSaving(true)
    setSaveError(null)
    try {
      // Re-ingest with the user-chosen sides. user_side drives line/card
      // extraction inside the ingestor (which moves become quizzed steps), so
      // patching the chapter row alone would keep lines built for the wrong
      // side. The preview ingest always resolved to 'white' as a placeholder.
      const result = new PgnIngestor().ingest(preview.text, {
        resolveStartingSide: (p) => overrides[p.name] ?? 'white',
      })
      const baseName = preview.fileName.replace(/\.pgn$/i, '') || 'Imported PGN'
      const pgnId = await repo.savePgn({
        name: baseName,
        source_path: preview.sourcePath,
        lichess_study_id: preview.lichessStudyId,
        is_challenge: isChallenge,
        result,
      })
      // Land the user directly on their first variant in Aprender — the
      // course-root auto-pick resolves the line and forwards the banner.
      const lineCount = result.chapters.reduce(
        (n, c) => n + c.line_ids.length,
        0,
      )
      navigate(`/pgn/${pgnId}?tab=learn`, {
        state: {
          banner: `“${baseName}” imported — ${
            lineCount === 1 ? '1 line' : `${lineCount} lines`
          }`,
        },
      })
    } catch (err) {
      console.error('savePgn failed', err)
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="view-enter mx-auto max-w-3xl p-6">
      <PgnDropZone onPgnText={loadPreview} />
      {duplicate && (
        <ConfirmDialog
          title="Study already imported"
          body={`This study is already imported as “${duplicate.existingCourseName}”. You can create a duplicate course (it starts with no progress) or cancel.`}
          confirmLabel="Create duplicate"
          onConfirm={() => {
            openStudyPreview(
              duplicate.studyId,
              duplicate.studyName,
              duplicate.pgnText,
            )
            setDuplicate(null)
          }}
          onCancel={() => setDuplicate(null)}
        />
      )}
      <Link
        to="/"
        className="text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        ← Back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Import PGN</h1>

      {!preview && (
        <div className="mt-6">
          <EmptyState
            icon={<span className="text-3xl">♞</span>}
            title="Drop your .pgn file here"
            hint="or pick it from your computer."
            action={
              <label className="inline-block">
                <span className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover">
                  Choose .pgn file
                </span>
                <input
                  type="file"
                  accept=".pgn"
                  onChange={handleFile}
                  className="hidden"
                />
              </label>
            }
          />

          <section className="mt-6 rounded-xl border border-line bg-surface-1 p-4">
            <h2 className="text-sm font-medium text-ink">
              or paste a Lichess study URL
            </h2>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void handleStudyImport()
              }}
            >
              <input
                type="text"
                value={studyUrl}
                onChange={(e) => setStudyUrl(e.target.value)}
                placeholder="https://lichess.org/study/…"
                disabled={downloading}
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={downloading || studyUrl.trim() === ''}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover disabled:opacity-50"
              >
                {downloading ? 'Downloading…' : 'Import study'}
              </button>
            </form>
            {downloading && (
              <p className="mt-2 text-xs text-ink-muted">
                Downloading the study from Lichess…
              </p>
            )}
            {studyError && (
              <p className="mt-2 text-sm text-danger">{studyError}</p>
            )}
          </section>
        </div>
      )}

      {parseError && (
        <p className="mt-4 text-sm text-danger">Error: {parseError}</p>
      )}

      {preview && (
        <>
          <label className="mt-6 inline-block">
            <span className="cursor-pointer text-sm text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline">
              Choose another .pgn file
            </span>
            <input
              type="file"
              accept=".pgn"
              onChange={handleFile}
              className="hidden"
            />
          </label>
          <section className="mt-6">
            <h2 className="text-lg font-medium">
              {preview.result.chapters.length} chapter
              {preview.result.chapters.length === 1 ? '' : 's'} detected
            </h2>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface-1">
              {preview.result.chapters.map((c) => {
                const needsSide = preview.initialPosChapterNames.has(c.name)
                const currentSide = overrides[c.name] ?? c.user_side
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between p-3"
                  >
                    <div>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {c.card_ids.length} cards · {c.line_ids.length} lines
                      </span>
                      {needsSide && (
                        <span className="ml-2 text-xs text-accent">
                          (initial position — choose side)
                        </span>
                      )}
                    </div>
                    {needsSide ? (
                      <select
                        value={currentSide}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [c.name]: e.target.value as UserSide,
                          }))
                        }
                        className="rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink"
                      >
                        <option value="white">white</option>
                        <option value="black">black</option>
                        <option value="stm">side-to-move</option>
                      </select>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        {c.user_side}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {preview.result.warnings.length > 0 && (
            <section className="mt-4 rounded-md border border-accent/30 bg-accent-soft p-3 text-sm">
              <p className="font-medium text-accent">
                {preview.result.warnings.length} lines with warnings
              </p>
              <ul className="mt-2 list-disc pl-5 text-xs text-accent">
                {preview.result.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>
                    <span className="font-mono">{w.code}</span> —{' '}
                    {w.chapter_name ? `${w.chapter_name}: ` : ''}
                    {w.message}
                  </li>
                ))}
                {preview.result.warnings.length > 10 && (
                  <li>…and {preview.result.warnings.length - 10} more</li>
                )}
              </ul>
            </section>
          )}

          <label className="mt-6 flex cursor-pointer items-start gap-2 rounded-md border border-line bg-surface-1 p-3">
            <input
              type="checkbox"
              checked={isChallenge}
              onChange={(e) => setIsChallenge(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span className="text-sm">
              <span className="font-medium text-ink">
                This PGN is exercises — challenge me directly
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                New positions are quizzed blind instead of teaching you the
                solution first. Great for tactics; leave it off for repertoires.
              </span>
            </span>
          </label>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm import'}
          </button>

          {saveError && (
            <div className="mt-4 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
              <p className="font-medium">Save error:</p>
              <pre className="mt-1 whitespace-pre-wrap text-xs">
                {saveError}
              </pre>
            </div>
          )}
        </>
      )}
    </main>
  )
}
