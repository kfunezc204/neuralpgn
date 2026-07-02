import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { ChessBoard } from '../components/ChessBoard.tsx'
import { buildWeakPoints, SESSION_CAP } from '../lib/WeakPointDeck.ts'
import { orientationFor } from '../lib/WalkMapping.ts'
import { sanToFromTo } from '../lib/MoveResolver.ts'
import type { ChapterRow, PersistedCard } from '../lib/Repository.ts'

interface PuzzleItem {
  cardId: number
  fen: string
  expectedSan: string
  comment: string | null
  orientation: 'white' | 'black'
  chapterName: string
}

type Answer = { correct: boolean; played: string } | null

// One-move reinforcement puzzles built from the weak-point deck: positions
// the trainee keeps missing in quizzes. Single attempt per puzzle — this is
// diagnosis, not a quiz with a safety net. Results feed back into the deck
// (a solve advances the graduation streak, a miss bumps the score) but never
// touch the SRS scheduler: the line stays the only schedulable atom.
export function PuzzleSessionView() {
  const { pgnId } = useParams<{ pgnId: string }>()
  const repo = useRepository()

  const [pgnName, setPgnName] = useState<string | null>(null)
  const [items, setItems] = useState<PuzzleItem[] | null>(null)
  const [round, setRound] = useState(0)
  const [idx, setIdx] = useState(0)
  const [solved, setSolved] = useState(0)
  const [answer, setAnswer] = useState<Answer>(null)
  const [hintShown, setHintShown] = useState(false)
  const [boardTick, setBoardTick] = useState(0)

  useEffect(() => {
    const id = Number(pgnId)
    if (!Number.isFinite(id)) {
      setItems([])
      return
    }
    let cancelled = false
    void (async () => {
      const [summaries, misses, attempts, archived] = await Promise.all([
        repo.listPgns(),
        repo.getMoveMissesForPgn(id),
        repo.getPuzzleAttemptsForPgn(id),
        repo.getArchivedLinesForPgn(id),
      ])
      if (cancelled) return
      setPgnName(summaries.find((s) => s.id === id)?.name ?? null)

      const archivedIds = new Set(archived.map((e) => e.line.id))
      const chapterCache = new Map<number, ChapterRow | null>()
      const cardsCache = new Map<number, PersistedCard[]>()
      const out: PuzzleItem[] = []
      for (const wp of buildWeakPoints(misses, attempts)) {
        if (out.length >= SESSION_CAP) break
        // Positions whose every source line is archived stay out of the deck.
        const lineId = wp.line_ids.find((lid) => !archivedIds.has(lid))
        if (lineId === undefined) continue
        const line = await repo.getLine(lineId)
        if (!line) continue
        const step = line.steps.find((s) => s.card_id === wp.card_id)
        if (!step) continue
        let chapter = chapterCache.get(line.chapter_id)
        if (chapter === undefined) {
          chapter = await repo.getChapter(line.chapter_id)
          chapterCache.set(line.chapter_id, chapter)
        }
        if (!chapter) continue
        let cards = cardsCache.get(line.chapter_id)
        if (!cards) {
          cards = await repo.getCardsForChapter(line.chapter_id)
          cardsCache.set(line.chapter_id, cards)
        }
        const card = cards.find((c) => c.id === wp.card_id)
        if (!card) continue
        out.push({
          cardId: wp.card_id,
          fen: card.fen_canonical,
          expectedSan: step.expected_san,
          comment: card.comment,
          orientation: orientationFor(chapter.user_side, card.fen_canonical),
          chapterName: chapter.name,
        })
      }
      if (cancelled) return
      setItems(out)
      setIdx(0)
      setSolved(0)
      setAnswer(null)
      setHintShown(false)
    })()
    return () => {
      cancelled = true
    }
  }, [pgnId, repo, round])

  const current = items && idx < items.length ? items[idx] : null
  const sessionDone = items !== null && items.length > 0 && idx >= items.length

  function nextPuzzle() {
    setAnswer(null)
    setHintShown(false)
    setIdx((i) => i + 1)
  }

  function handleMove(m: { san: string }) {
    if (!current || answer !== null) return
    const correct = m.san === current.expectedSan
    // Each puzzle is atomic — record immediately so quitting mid-session
    // keeps what was already answered (unlike the walk's completion boundary).
    void repo.recordPuzzleAttempt({
      card_id: current.cardId,
      ts: new Date(),
      correct,
    })
    if (correct) {
      setSolved((n) => n + 1)
      setAnswer({ correct: true, played: m.san })
      setTimeout(nextPuzzle, 700)
    } else {
      // Snap the piece back and reveal the expected move on the board.
      setBoardTick((t) => t + 1)
      setAnswer({ correct: false, played: m.san })
    }
  }

  const backHref = `/pgn/${pgnId}`

  if (items === null) {
    return <main className="p-6 text-sm text-ink-muted">Cargando…</main>
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Link to={backHref} className="text-sm text-ink-muted hover:underline">
          ← Volver al curso
        </Link>
        <h1 className="mt-6 text-xl font-semibold">🎯 Puntos débiles</h1>
        <p className="mt-2 text-ink-muted">
          No hay posiciones pendientes de refuerzo. ¡Buen trabajo!
        </p>
      </main>
    )
  }

  if (sessionDone) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Sesión de puzzles completa</h1>
        <p className="mt-2 text-ink-muted">
          Resolviste <span className="font-semibold text-ok">{solved}</span> de{' '}
          {items.length} posiciones.
        </p>
        <div className="mt-6 flex gap-2">
          <Link
            to={backHref}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover"
          >
            Volver al curso
          </Link>
          <button
            type="button"
            onClick={() => {
              setItems(null)
              setRound((r) => r + 1)
            }}
            className="rounded-md border border-line-strong px-4 py-2 text-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2"
          >
            Otra ronda
          </button>
        </div>
      </main>
    )
  }

  if (!current) {
    return <main className="p-6 text-sm text-ink-muted">Cargando…</main>
  }

  const expectedMove =
    answer !== null && !answer.correct
      ? (sanToFromTo(current.fen, current.expectedSan) ?? undefined)
      : undefined

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0">
      <header className="flex items-center justify-between border-b border-line bg-surface-1 px-4 py-2">
        <Link
          to={backHref}
          className="text-sm text-ink-muted hover:text-ink hover:underline"
        >
          ← Volver al curso
        </Link>
        <div className="text-sm font-medium text-ink-muted">
          🎯 Puntos débiles{pgnName ? ` · ${pgnName}` : ''}
        </div>
        <span className="font-mono text-xs tabular-nums text-ink-muted">
          Puzzle {idx + 1} / {items.length} · {current.chapterName}
        </span>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col items-center gap-4">
          <div
            className={`relative rounded-md transition-shadow duration-300 ${
              answer === null
                ? ''
                : answer.correct
                  ? 'ring-4 ring-ok'
                  : 'ring-4 ring-accent'
            }`}
            style={{
              width: 'min(100%, calc(100vh - 220px))',
              aspectRatio: '1 / 1',
            }}
          >
            <ChessBoard
              fen={current.fen}
              orientation={current.orientation}
              revertToken={boardTick}
              highlight={expectedMove}
              onMove={answer === null ? handleMove : undefined}
            />
          </div>
          <div className="text-center">
            {answer === null && (
              <>
                <p className="text-sm text-ink-muted">
                  Tu turno — juega la jugada
                </p>
                {hintShown ? (
                  <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
                    {current.comment}
                  </p>
                ) : (
                  current.comment && (
                    <button
                      type="button"
                      onClick={() => setHintShown(true)}
                      className="mt-2 text-xs text-accent underline decoration-accent/40 underline-offset-2 transition-colors duration-150 hover:text-accent-hover"
                    >
                      Mostrar pista
                    </button>
                  )
                )}
              </>
            )}
            {answer !== null && answer.correct && (
              <p className="text-sm font-medium text-ok">✓ {answer.played}</p>
            )}
            {answer !== null && !answer.correct && (
              <>
                <p className="text-sm font-medium text-accent">
                  ✗ Jugaste {answer.played} — la jugada era{' '}
                  {current.expectedSan}
                </p>
                {current.comment && (
                  <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
                    {current.comment}
                  </p>
                )}
                <button
                  type="button"
                  onClick={nextPuzzle}
                  className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover"
                >
                  Siguiente →
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
