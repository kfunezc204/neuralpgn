import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { SessionSelector } from '../lib/SessionSelector.ts'
import { WalkCore, type WalkCompletionStats } from '../components/WalkCore.tsx'
import { CommentsPanel } from '../components/CommentsPanel.tsx'
import type { WalkHistoryEntry } from '../lib/WalkHistory.ts'
import type {
  ChapterRow,
  DueLineGlobalRef,
  PersistedLine,
} from '../lib/Repository.ts'

// Global "Repasar todo" session: an interleaved pool of due lines across all
// chapters, walked one by one. Each walk is a full-featured WalkCore quiz
// (prefix autoplay, hint, refutation animation, completion overlay) — this
// route only owns the pool, the session summary, and the right-hand panel.
export function GlobalWalkView() {
  const repo = useRepository()
  const navigate = useNavigate()

  const [pool, setPool] = useState<DueLineGlobalRef[]>([])
  const [poolIdx, setPoolIdx] = useState(0)
  const [empty, setEmpty] = useState(false)
  const [summary, setSummary] = useState({ good: 0, hard: 0, again: 0 })

  // Right-panel state mirroring CourseLayout's wiring of WalkCore.
  const [history, setHistory] = useState<WalkHistoryEntry[]>([])
  const [walkChapter, setWalkChapter] = useState<ChapterRow | null>(null)
  const [walkLine, setWalkLine] = useState<PersistedLine | null>(null)
  const [walkInitialFen, setWalkInitialFen] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [chapterLineCount, setChapterLineCount] = useState(0)

  // Build the interleaved pool once per session.
  useEffect(() => {
    void (async () => {
      const refs = await repo.getDueLinesAllChapters(new Date())
      if (refs.length === 0) {
        setEmpty(true)
        return
      }
      setPool(new SessionSelector().pickInterleavedGlobalLines(refs))
    })()
  }, [repo])

  const ref = pool.length > 0 && poolIdx < pool.length ? pool[poolIdx] : null
  const done = pool.length > 0 && poolIdx >= pool.length

  // The variant label needs the chapter's line count; fetch it when the walk
  // enters a new chapter.
  useEffect(() => {
    if (!walkChapter) {
      setChapterLineCount(0)
      return
    }
    let cancelled = false
    void (async () => {
      const lines = await repo.getLinesForChapter(walkChapter.id)
      if (!cancelled) setChapterLineCount(lines.length)
    })()
    return () => {
      cancelled = true
    }
  }, [walkChapter, repo])

  // Reset the panel for every new line in the pool.
  const currentLineId = ref?.line_id ?? null
  useEffect(() => {
    setHistory([])
    setWalkLine(null)
    setWalkInitialFen(null)
  }, [currentLineId])

  function handleComplete(stats: WalkCompletionStats) {
    setSummary((prev) => ({
      good: prev.good + (stats.outcome === 'pass_all_first' ? 1 : 0),
      hard: prev.hard + (stats.outcome === 'pass_with_retry' ? 1 : 0),
      again: prev.again + (stats.outcome === 'fail' ? 1 : 0),
    }))
  }

  function handleLineLoad(line: PersistedLine | null) {
    setWalkLine(line)
    // A pool entry can vanish between pool build and walk (deleted/archived
    // from another view); skip it instead of hanging on a loading screen.
    if (line === null) setPoolIdx((i) => i + 1)
  }

  if (empty) {
    return (
      <main className="view-enter mx-auto max-w-3xl p-6">
        <Link
          to="/"
          className="text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          ← Volver
        </Link>
        <p className="mt-6 text-ink-muted">No hay líneas due ahora mismo.</p>
      </main>
    )
  }

  if (done) {
    return (
      <main className="view-enter mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sesión global completa
        </h1>
        <p className="mt-2 font-mono tabular-nums text-ink-muted">
          <span className="text-ok">{summary.good} Good</span> ·{' '}
          <span className="text-accent">{summary.hard} Hard</span> ·{' '}
          <span className="text-danger">{summary.again} Again</span>
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2"
          >
            Cerrar
          </Link>
        </div>
      </main>
    )
  }

  if (!ref) {
    return <main className="p-6 text-sm text-ink-muted">Cargando…</main>
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface-1 px-4 py-2">
          <Link
            to="/"
            className="text-sm text-ink-muted hover:text-ink hover:underline"
          >
            ← Biblioteca
          </Link>
          <div className="text-sm font-medium text-ink-muted">
            Repasar todo
          </div>
          <span className="font-mono text-xs tabular-nums text-ink-muted">
            Línea {poolIdx + 1} / {pool.length} · {ref.chapter_name}
          </span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <WalkCore
            key={ref.line_id}
            lineId={ref.line_id}
            mode="quiz"
            onComplete={handleComplete}
            onNavigateNext={() => setPoolIdx((i) => i + 1)}
            onExit={() => navigate('/')}
            onHistoryChange={setHistory}
            onChapterChange={setWalkChapter}
            onLineLoad={handleLineLoad}
            onInitialFen={setWalkInitialFen}
          />
        </main>
      </div>
      <CommentsPanel
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
        chapter={walkChapter}
        line={walkLine}
        chapterLineCount={chapterLineCount}
        mode="quiz"
        initialFen={walkInitialFen}
        history={history}
      />
    </div>
  )
}
