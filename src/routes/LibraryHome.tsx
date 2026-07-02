import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { useProfile } from '../lib/ProfileContext.tsx'
import { CourseCard } from '../components/CourseCard.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { PromptDialog } from '../components/PromptDialog.tsx'
import { SettingsDialog } from '../components/SettingsDialog.tsx'
import { PgnDropZone } from '../components/PgnDropZone.tsx'
import { LibrarySkeleton } from '../components/ui/Skeleton.tsx'
import { buttonClasses } from '../components/ui/Button.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { formatNextReview } from '../lib/NextReviewFormatter.ts'
import { summarizeDay } from '../lib/DailySummary.ts'
import { fetchActiveWeakPointCount } from '../lib/WeakPointDeck.ts'
import type { DailySummaryResult } from '../lib/DailySummary.ts'
import type { PgnCounters, PgnSummary } from '../lib/Repository.ts'

interface PgnCardData {
  pgn: PgnSummary
  counters: PgnCounters
  weakPoints: number
}

export function LibraryHome() {
  const repo = useRepository()
  const profile = useProfile()
  const navigate = useNavigate()
  const [cards, setCards] = useState<PgnCardData[]>([])
  const [globalDueCount, setGlobalDueCount] = useState(0)
  const [daySummary, setDaySummary] = useState<DailySummaryResult>({
    reviewedToday: 0,
    newToday: 0,
  })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      const list = await repo.listPgns()
      const now = new Date()
      // One aggregate query set for the whole library; weak-point counts are
      // TS-side aggregations (streak logic), so those stay per-course but run
      // in parallel instead of serially.
      const [allCounters, weakPointsList] = await Promise.all([
        repo.getAllPgnCounters(now),
        Promise.all(list.map((p) => fetchActiveWeakPointCount(repo, p.id))),
      ])
      const empty: PgnCounters = {
        total: 0,
        learned: 0,
        mastered: 0,
        due: 0,
        nextDueAt: null,
        learnedThisWeek: 0,
      }
      const data: PgnCardData[] = list.map((p, i) => ({
        pgn: p,
        counters: allCounters.get(p.id) ?? empty,
        weakPoints: weakPointsList[i],
      }))
      setCards(data)
      const dueLines = await repo.getDueLinesAllChapters(now)
      setGlobalDueCount(dueLines.length)
      const dayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      )
      const activity = await repo.getReviewActivitySince(dayStart)
      setDaySummary(summarizeDay(activity, now))
      if (!opts?.silent) setLoading(false)
    },
    [repo],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Counters and the "Repasar todo" badge are due-date comparisons against
  // query time, so they go stale while the app sits open on this screen
  // (e.g. waiting out a 10-minute learning step). Silent so the periodic
  // re-query doesn't flash the loading state.
  useEffect(() => {
    const id = setInterval(() => void refresh({ silent: true }), 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const [pendingDelete, setPendingDelete] = useState<{
    id: number
    name: string
  } | null>(null)
  const [pendingRename, setPendingRename] = useState<{
    id: number
    name: string
  } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  async function confirmDelete() {
    if (!pendingDelete) return
    const { id } = pendingDelete
    setPendingDelete(null)
    await repo.deletePgn(id)
    void refresh()
  }

  async function confirmRename(newName: string) {
    if (!pendingRename) return
    const { id } = pendingRename
    setPendingRename(null)
    await repo.renamePgn(id, newName)
    void refresh({ silent: true })
  }

  async function toggleChallenge(id: number, next: boolean) {
    await repo.setChallengeMode(id, next)
    void refresh({ silent: true })
  }

  // Earliest upcoming review across the whole library; null when nothing is
  // learned yet. Drives the "Al día ✓ · en X" state of the global button.
  const globalNextDueAt = cards.reduce<Date | null>((min, c) => {
    const d = c.counters.nextDueAt
    if (!d) return min
    if (!min || d.getTime() < min.getTime()) return d
    return min
  }, null)

  return (
    <main className="view-enter mx-auto max-w-3xl px-6 py-8">
      <PgnDropZone
        onPgnText={(name, text) =>
          navigate('/import', { state: { droppedFile: { name, text } } })
        }
      />
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NeuralPGN</h1>
          <button
            type="button"
            onClick={profile.requestSwitch}
            className="mt-1 text-xs text-ink-faint transition-colors duration-150 hover:text-ink"
            title="Cambiar de perfil"
          >
            Perfil: {profile.active.name} ▾
          </button>
          {(daySummary.reviewedToday > 0 || daySummary.newToday > 0) && (
            <p className="mt-1 text-xs text-ink-muted">
              Hoy:{' '}
              <span className="font-mono tabular-nums">
                {daySummary.reviewedToday}
              </span>{' '}
              repasadas ·{' '}
              <span className="font-mono tabular-nums">
                {daySummary.newToday}
              </span>{' '}
              nuevas
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {globalDueCount > 0 ? (
            <Link
              to="/repasar-todo"
              className={buttonClasses({ variant: 'primary' })}
            >
              Repasar todo
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-contrast/15 px-1.5 font-mono text-xs font-semibold tabular-nums">
                {globalDueCount}
              </span>
            </Link>
          ) : globalNextDueAt ? (
            <span
              aria-disabled="true"
              title="No hay líneas due"
              className={buttonClasses({ disabled: true })}
            >
              Al día ✓ · {formatNextReview(globalNextDueAt, new Date())}
            </span>
          ) : (
            <span
              aria-disabled="true"
              title="No hay líneas due"
              className={buttonClasses({ disabled: true })}
            >
              Repasar todo · 0
            </span>
          )}
          <Link
            to="/import"
            className={buttonClasses({ variant: 'secondary' })}
          >
            Importar PGN
          </Link>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Ajustes"
            title="Ajustes"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            ⚙
          </button>
        </div>
      </header>

      {loading && cards.length === 0 ? (
        <LibrarySkeleton />
      ) : cards.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<span className="text-3xl">♞</span>}
            title="Tu biblioteca está vacía"
            hint="Importa un PGN para empezar a entrenar tu repertorio."
            action={
              <Link
                to="/import"
                className={buttonClasses({ variant: 'primary' })}
              >
                Importar PGN
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {cards.map(({ pgn, counters, weakPoints }) => (
            <CourseCard
              key={pgn.id}
              pgn={pgn}
              counters={counters}
              weakPoints={weakPoints}
              onRename={() => setPendingRename({ id: pgn.id, name: pgn.name })}
              onToggleChallenge={() =>
                void toggleChallenge(pgn.id, !pgn.is_challenge)
              }
              onDelete={() => setPendingDelete({ id: pgn.id, name: pgn.name })}
            />
          ))}
        </ul>
      )}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
      {pendingRename && (
        <PromptDialog
          title="Renombrar curso"
          initialValue={pendingRename.name}
          placeholder="Nombre del curso"
          confirmLabel="Renombrar"
          onConfirm={(name) => void confirmRename(name)}
          onCancel={() => setPendingRename(null)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          variant="danger"
          title={`Borrar "${pendingDelete.name}"`}
          body="Se eliminará el curso y todo su progreso de aprendizaje. Esta acción no se puede deshacer."
          confirmLabel="Borrar curso"
          cancelLabel="Cancelar"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </main>
  )
}
