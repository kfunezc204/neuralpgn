import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { WalkEngine, type WalkStep } from '../lib/WalkEngine.ts'
import { commitLineReview } from '../lib/LineReviewRecorder.ts'
import { playComplete, playCorrect, playWrong } from '../lib/FeedbackSounds.ts'
import {
  orientationFor,
  persistedToCard,
  persistedToLine,
} from '../lib/WalkMapping.ts'
import { ChessBoard } from './ChessBoard.tsx'
import { CompletionPanel } from './CompletionPanel.tsx'
import { ReplayControls } from './ReplayControls.tsx'
import {
  expandSanSequence,
  findConnectingMove,
  sanToFromTo,
} from '../lib/MoveResolver.ts'
import {
  emptyHistory,
  recordHistory,
  type WalkHistoryEntry,
} from '../lib/WalkHistory.ts'
import {
  shouldOfferCompletionReview,
  stepCompletionReview,
  type ReviewNavAction,
} from '../lib/CompletionReviewPolicy.ts'
import type { WalkMode } from '../lib/TabModeResolver.ts'
import type {
  ChapterRow,
  PersistedLine,
  PersistedLineState,
} from '../lib/Repository.ts'
import type { BoardShape, Card, LineOutcome } from '../lib/types.ts'
import type { MoveMissKind } from '../lib/WeakPointDeck.ts'

export interface WalkCompletionStats {
  outcome: LineOutcome
  retriesUsed: number
  totalQuizzed: number
  lineState: PersistedLineState | null
  /** Quiz wall time in ms; absent for untimed walks (teach/refresher). */
  durationMs?: number
}

export interface ReplayController {
  next: () => void
  prev: () => void
  first: () => void
  last: () => void
  jumpTo: (i: number) => void
}

interface WalkCoreProps {
  lineId: number
  mode: WalkMode
  onComplete?: (stats: WalkCompletionStats) => void
  onNavigateNext?: () => void
  onExit?: () => void
  onHistoryChange?: (entries: WalkHistoryEntry[]) => void
  onChapterChange?: (chapter: ChapterRow | null) => void
  onLineLoad?: (line: PersistedLine | null) => void
  onInitialFen?: (fen: string | null) => void
  onProgressChange?: (hasProgress: boolean) => void
  onReplayController?: (ctrl: ReplayController | null) => void
  onReplayStepChange?: (stepIndex: number, totalSteps: number) => void
  /** Extra action rendered in the completion panel (e.g. next-step offer). */
  completionExtra?: ReactNode
  /** Challenge course: completion shows the solve time. */
  isChallenge?: boolean
}

type Feedback =
  | { kind: 'none' }
  | { kind: 'retry'; played: string }
  | { kind: 'correct'; san: string }
  | { kind: 'reveal-fail'; expected: string; played: string }

// Pacing (ms). Self-driven playback (refresher walks and the autoplayed
// prefix in teach) goes ply by ply — user move, beat, opponent reply, beat —
// slow enough to assimilate. Quiz keeps its snappy timings: there the user
// sets the pace and autoplay only fast-forwards opponent/failed moves.
const AUTOPLAY_STEP_MS = 900
const AUTOPLAY_REPLY_MS = 900
const QUIZ_AUTOPLAY_STEP_MS = 400
const QUIZ_REPLY_MS = 450
// Board ring at completion mirrors the rating colors of CompletionPanel.
const OUTCOME_RING: Record<LineOutcome, string> = {
  pass_all_first: 'ring-ok',
  pass_with_retry: 'ring-accent',
  fail: 'ring-danger',
}

export function WalkCore({
  lineId,
  mode,
  onComplete,
  onNavigateNext,
  onExit,
  onHistoryChange,
  onChapterChange,
  onLineLoad,
  onInitialFen,
  onProgressChange,
  onReplayController,
  onReplayStepChange,
  completionExtra,
  isChallenge = false,
}: WalkCoreProps) {
  const repo = useRepository()
  const engineRef = useRef<WalkEngine | null>(null)

  const [chapter, setChapter] = useState<ChapterRow | null>(null)
  const [engine, setEngine] = useState<WalkEngine | null>(null)
  const [step, setStep] = useState<WalkStep | null>(null)
  const [done, setDone] = useState(false)
  const [completionStats, setCompletionStats] =
    useState<WalkCompletionStats | null>(null)
  const [priorLineState, setPriorLineState] =
    useState<PersistedLineState | null>(null)
  const [cardsByIdStr, setCardsByIdStr] = useState<Map<string, Card>>(new Map())
  const [lineStartFen, setLineStartFen] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' })
  const [boardTick, setBoardTick] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const [hintComment, setHintComment] = useState<string | null>(null)
  const [hintShapes, setHintShapes] = useState<BoardShape[] | null>(null)
  const [refutationFrame, setRefutationFrame] = useState(0)
  // Opponent-reply choreography for fixed-side chapters (line.steps hold only
  // the user's moves; the reply between two steps is implicit in the card
  // FENs). phaseFen shows the user's move applied before the reply lands;
  // oppReply highlights the reply on the next step's board.
  const [phaseFen, setPhaseFen] = useState<string | null>(null)
  const [oppReply, setOppReply] = useState<{ from: string; to: string } | null>(
    null,
  )
  // Final-position display: the 'done' step carries no fen, so without these
  // the board would fall back to lastBoardFenRef — the position BEFORE the
  // user's last move. finalFen pins the post-move position and finalMove
  // keeps its squares highlighted while the completion summary shows.
  const [finalFen, setFinalFen] = useState<string | null>(null)
  const [finalMove, setFinalMove] = useState<{
    from: string
    to: string
  } | null>(null)
  // Post-completion review track: one entry per line step (position before
  // the user's move + the move), replay-style. reviewIdx null = resting on
  // the real final position (the normal completion view).
  const [reviewSteps, setReviewSteps] = useState<
    {
      fen: string
      san: string
      shapes?: BoardShape[]
      shapesAfter?: BoardShape[]
    }[]
  >([])
  const [reviewIdx, setReviewIdx] = useState<number | null>(null)
  const historyRef = useRef<WalkHistoryEntry[]>(emptyHistory())
  // Per-move misses buffered during a quiz walk. Written to the DB only at
  // natural completion, alongside the review event — same persistence
  // boundary as the SRS write (abandoning mid-walk discards them).
  const missesRef = useRef<
    {
      card_id: number
      kind: MoveMissKind
      played_san: string
      expected_san: string | null
    }[]
  >([])
  const lastBoardFenRef = useRef<string | null>(null)
  // Solve-time clock: starts when the first quiz step is shown, read at
  // natural completion. Untimed walks (teach/refresher/replay) never start it.
  const quizStartRef = useRef<number | null>(null)
  const persistedRef = useRef(false)
  const progressRef = useRef(false)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function markProgress() {
    if (!progressRef.current) {
      progressRef.current = true
      onProgressChange?.(true)
    }
  }

  function pushHistory(entry: WalkHistoryEntry) {
    historyRef.current = recordHistory(historyRef.current, entry)
    onHistoryChange?.(historyRef.current)
  }

  useEffect(() => {
    if (!Number.isFinite(lineId)) return
    void (async () => {
      const targetLine = await repo.getLine(lineId)
      if (!targetLine) {
        onLineLoad?.(null)
        return
      }
      const chId = targetLine.chapter_id
      const c = await repo.getChapter(chId)
      setChapter(c)
      onChapterChange?.(c)
      onLineLoad?.(targetLine)
      if (!c) return

      const [persistedCards, allStates] = await Promise.all([
        repo.getCardsForChapter(chId),
        repo.getLineStatesForChapter(chId),
      ])
      const stateMap = new Map(allStates.map((s) => [s.line_id, s]))
      const prior = stateMap.get(lineId) ?? null
      setPriorLineState(prior)

      const cards = persistedCards.map(persistedToCard)
      setCardsByIdStr(new Map(cards.map((cc) => [cc.id, cc])))

      const firstStep = targetLine.steps[0]
      const firstCardDbId = firstStep ? firstStep.card_id : null
      const firstCard =
        firstCardDbId !== null
          ? (persistedCards.find((p) => p.id === firstCardDbId) ?? null)
          : null
      setLineStartFen(firstCard?.fen_canonical ?? null)
      onInitialFen?.(firstCard?.fen_canonical ?? null)

      const cardById = new Map(persistedCards.map((p) => [p.id, p]))
      setReviewSteps(
        targetLine.steps.flatMap((s) => {
          const card = cardById.get(s.card_id)
          return card
            ? [
                {
                  fen: card.fen_canonical,
                  san: s.expected_san,
                  ...(card.shapes ? { shapes: card.shapes } : {}),
                  ...(s.shapes_after ? { shapesAfter: s.shapes_after } : {}),
                },
              ]
            : []
        }),
      )

      const lineForEngine = persistedToLine(targetLine)
      const dominated =
        mode === 'refresher' || mode === 'replay'
          ? []
          : (await repo.getDominatedLinesForChapter(chId)).map(persistedToLine)
      const opts = { dominatedSiblings: dominated }

      const e =
        mode === 'quiz'
          ? WalkEngine.quiz(lineForEngine, cards, opts)
          : mode === 'teach'
            ? WalkEngine.teach(lineForEngine, cards, opts)
            : mode === 'refresher'
              ? WalkEngine.refresher(lineForEngine, cards)
              : WalkEngine.replay(lineForEngine, cards)
      engineRef.current = e
      setEngine(e)
      persistedRef.current = false
      quizStartRef.current = null
      progressRef.current = false
      onProgressChange?.(false)
      setDone(false)
      setCompletionStats(null)
      setPhaseFen(null)
      setOppReply(null)
      setFinalFen(null)
      setFinalMove(null)
      setReviewIdx(null)
      historyRef.current = emptyHistory()
      missesRef.current = []

      if (mode === 'replay') {
        const initial = e.currentStep()
        setStep(initial)
        // Pre-populate the full history so the right-hand panel shows every
        // move from the start (no spoiler-safe in replay).
        const entries: WalkHistoryEntry[] = lineForEngine.steps.map((s) => {
          const c = cards.find((cc) => cc.id === s.card_id)
          const entry: WalkHistoryEntry = {
            kind: 'replay',
            san: s.expected_san,
          }
          if (c?.comment) (entry as { comment?: string }).comment = c.comment
          return entry
        })
        historyRef.current = entries
        onHistoryChange?.(historyRef.current)
        if (initial.kind === 'replay') {
          onReplayStepChange?.(initial.stepIndex, initial.totalSteps)
        }
      } else {
        setStep(e.current())
        onHistoryChange?.(historyRef.current)
      }
    })()
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current)
        advanceTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, mode, repo])

  const isQuiz = mode === 'quiz'
  const isRefresher = mode === 'refresher'
  const isReplay = mode === 'replay'

  // Start the solve clock the first time an interactive quiz step is shown
  // (after any autoplayed prefix); it survives until natural completion.
  useEffect(() => {
    if (step?.kind === 'quiz' && quizStartRef.current === null) {
      quizStartRef.current = Date.now()
    }
  }, [step])

  function applyReplayStep() {
    const e = engineRef.current
    if (!e) return
    const cur = e.currentStep()
    setStep(cur)
    if (cur.kind === 'replay') {
      onReplayStepChange?.(cur.stepIndex, cur.totalSteps)
    }
  }

  function replayNext() {
    const e = engineRef.current
    if (!e) return
    e.next()
    applyReplayStep()
  }
  function replayPrev() {
    const e = engineRef.current
    if (!e) return
    e.prev()
    applyReplayStep()
  }
  function replayJumpTo(i: number) {
    const e = engineRef.current
    if (!e) return
    e.jumpTo(i)
    applyReplayStep()
  }
  function replayFirst() {
    replayJumpTo(0)
  }
  function replayLast() {
    const e = engineRef.current
    if (!e) return
    const total = e.progress().total
    replayJumpTo(total - 1)
  }

  // Publish the ReplayController to the parent so CommentsPanel can hook into
  // jumpTo. Republish whenever the engine identity changes (a new lineId loads).
  useEffect(() => {
    if (!isReplay) {
      onReplayController?.(null)
      return
    }
    if (!engine) return
    const ctrl: ReplayController = {
      next: replayNext,
      prev: replayPrev,
      first: replayFirst,
      last: replayLast,
      jumpTo: replayJumpTo,
    }
    onReplayController?.(ctrl)
    return () => {
      onReplayController?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay, engine])

  // Keyboard navigation for replay mode. ← / → step, Home/End jump to extremes.
  useEffect(() => {
    if (!isReplay) return
    function onKey(ev: KeyboardEvent) {
      if (ev.target instanceof HTMLElement) {
        const tag = ev.target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          ev.target.isContentEditable
        ) {
          return
        }
      }
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault()
        replayPrev()
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault()
        replayNext()
      } else if (ev.key === 'Home') {
        ev.preventDefault()
        replayFirst()
      } else if (ev.key === 'End') {
        ev.preventDefault()
        replayLast()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay, engine])

  // Ply timeline for post-completion review: one frame per half-move, so each
  // ▶ press advances exactly one ply — the user's move OR the opponent's
  // implicit reply, never both at once. Frames carry their own board hints:
  // `highlight` marks the expected move on user-to-move frames, `lastMove`
  // the ply that just landed.
  const reviewFrames = useMemo(() => {
    if (reviewSteps.length === 0) return []
    const canon = (f: string) => f.split(' ').slice(0, 4).join(' ')
    const frames: {
      fen: string
      highlight: { from: string; to: string } | null
      lastMove: { from: string; to: string } | null
      shapes: BoardShape[] | null
    }[] = []
    let landing: { from: string; to: string } | null = null
    let endFen: string | null = null
    let finalShapes: BoardShape[] | null = null
    for (let i = 0; i < reviewSteps.length; i++) {
      const s = reviewSteps[i]
      const userMove = sanToFromTo(s.fen, s.san)
      // Card shapes belong to the user-to-move frame: the author drew them on
      // the position where this move has to be found.
      frames.push({
        fen: s.fen,
        highlight: userMove,
        lastMove: landing,
        shapes: s.shapes ?? null,
      })
      const afterUser = fenAfterSan(s.fen, s.san)
      if (!afterUser) return []
      endFen = afterUser
      const nextFen =
        i + 1 < reviewSteps.length ? reviewSteps[i + 1].fen : finalFen
      if (nextFen && canon(afterUser) !== canon(nextFen)) {
        // Opponent reply lives between the steps: give the post-user-move
        // position its own frame so the reply is a separate ▶ press. Shapes
        // the author drew on the user's own move belong to this frame.
        frames.push({
          fen: afterUser,
          highlight: null,
          lastMove: userMove,
          shapes: s.shapesAfter ?? null,
        })
        landing = findConnectingMove(afterUser, nextFen)
        endFen = nextFen
      } else {
        landing = userMove
        // No intermediate frame: the post-move position IS the next frame
        // (stm lines) or the final one. Only the final frame needs the
        // shapes — mid-line they already live on the next step's card.
        if (i === reviewSteps.length - 1) finalShapes = s.shapesAfter ?? null
      }
    }
    frames.push({
      fen: finalFen ?? endFen ?? '',
      highlight: null,
      lastMove: landing,
      shapes: finalShapes,
    })
    return frames[frames.length - 1].fen ? frames : []
  }, [reviewSteps, finalFen])

  // Policy indices 0..total-1 are steppable frames; null rests on the final
  // frame (the normal completion view).
  const reviewTotal = Math.max(0, reviewFrames.length - 1)

  const reviewOffered =
    done &&
    !isReplay &&
    completionStats !== null &&
    reviewTotal > 0 &&
    shouldOfferCompletionReview(mode, completionStats.outcome)

  function navReview(action: ReviewNavAction) {
    setReviewIdx((cur) => stepCompletionReview(cur, action, reviewTotal))
  }

  // Completion-screen keyboard. Without review controls, Enter / → advance to
  // the next variant so chained sessions don't need the mouse. With review
  // controls the arrows step through the line (like replay mode) and Enter
  // stays the only next-variant shortcut. BUTTON is excluded for Enter so a
  // focused button's native Enter doesn't double-fire; arrows stay live even
  // with a control button focused.
  useEffect(() => {
    if (!done || isReplay) return
    function onKey(ev: KeyboardEvent) {
      if (ev.target instanceof HTMLElement) {
        const tag = ev.target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          ev.target.isContentEditable
        ) {
          return
        }
        if (tag === 'BUTTON' && ev.key === 'Enter') return
      }
      if (ev.key === 'Enter') {
        ev.preventDefault()
        onNavigateNext?.()
        return
      }
      if (!reviewOffered) {
        if (ev.key === 'ArrowRight') {
          ev.preventDefault()
          onNavigateNext?.()
        }
        return
      }
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault()
        navReview('prev')
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault()
        navReview('next')
      } else if (ev.key === 'Home') {
        ev.preventDefault()
        navReview('first')
      } else if (ev.key === 'End') {
        ev.preventDefault()
        navReview('last')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, isReplay, onNavigateNext, reviewOffered, reviewTotal])

  // Persistence boundary: lineState/review_event writes happen ONLY from this
  // function, and this function runs ONLY when finishIfDone observes a 'done'
  // step (i.e. the walk completed naturally). Sidebar navigation, lineId
  // changes and unmounts never touch the database — abandoning a mid-walk
  // leaves the previous SRS state intact. Do not call saveLineState from
  // anywhere else.
  async function persistAndComplete(o: LineOutcome) {
    if (persistedRef.current) return
    persistedRef.current = true
    // Whole-line retry total comes from the engine; the retryCount state is
    // per-step UI feedback and resets on every advance.
    const retriesUsed = engine?.retriesUsed() ?? 0
    const durationMs =
      mode === 'quiz' && quizStartRef.current !== null
        ? Date.now() - quizStartRef.current
        : undefined
    let savedLineState: PersistedLineState | null = priorLineState
    // A fully-autoplayed walk (dominated prefix + opponent tail) completes
    // with zero trainee input; grading it would mark an untouched line as
    // learned and leak it into the review queue.
    if (engine?.affectsScheduler && !engine.isFullyAutoplayed) {
      savedLineState = await commitLineReview({
        sink: repo,
        lineId,
        prior: priorLineState,
        outcome: o,
        retriesUsed,
        ...(durationMs !== undefined ? { durationMs } : {}),
      })
    }
    // Weak-point tracking: only quiz misses count (teach/refresher are
    // learning, not signal), flushed at the same boundary as the review.
    if (mode === 'quiz' && missesRef.current.length > 0) {
      const ts = new Date()
      await repo.recordMoveMisses(
        missesRef.current.map((m) => ({ ...m, line_id: lineId, ts })),
      )
      missesRef.current = []
    }

    const stats: WalkCompletionStats = {
      outcome: o,
      retriesUsed,
      totalQuizzed: engine?.quizzedCount() ?? 0,
      lineState: savedLineState,
      ...(durationMs !== undefined ? { durationMs } : {}),
    }
    setCompletionStats(stats)
    playComplete()
    onComplete?.(stats)
  }

  async function finishIfDone(next: WalkStep) {
    setStep(next)
    setFeedback({ kind: 'none' })
    setRetryCount(0)
    setHintComment(null)
    setHintShapes(null)
    setRefutationFrame(0)
    if (next.kind === 'done' && engine) {
      const o = engine.lineOutcome()
      setDone(true)
      // The walk persisted (or never will, for refresher): nothing is lost by
      // leaving now. Consuming the progress flag here kills the spurious
      // "no se guardará" warning when navigating away from the completion
      // screen — including after lingering in post-completion review.
      progressRef.current = false
      onProgressChange?.(false)
      await persistAndComplete(o)
    }
  }

  function handleHint() {
    if (!engine || !step || step.kind !== 'quiz') return
    const revealed = engine.hint()
    setHintComment(
      revealed.comment ?? (revealed.shapes ? '' : 'No hint available.'),
    )
    setHintShapes(revealed.shapes ?? null)
  }

  function fenAfterSan(fen: string, san: string): string | null {
    return expandSanSequence(fen, [san])[0]?.fen_after ?? null
  }

  // Advance the engine, weaving in the opponent's implicit reply when the
  // next card position isn't reachable from the user's move alone. In
  // fixed-side chapters line.steps hold only the user's moves, so the reply
  // lives implicitly between two consecutive card FENs: reconstruct it, log
  // it to the history (which also fixes move numbering), highlight it on the
  // next board, and — if the board still shows the pre-move position — play
  // the user's move first so the two plies land in sequence.
  function advanceWithReply(
    fenAfterUser: string | null,
    lastUserMove?: { from: string; to: string } | null,
    replyBeatMs: number = QUIZ_REPLY_MS,
  ) {
    const e = engineRef.current
    if (!e) return
    e.advance()
    const next = e.current()
    setOppReply(null)
    if (next.kind === 'done' && fenAfterUser) {
      setFinalFen(fenAfterUser)
      setFinalMove(lastUserMove ?? null)
    }
    const nextFen =
      next.kind === 'quiz' || next.kind === 'teach' || next.kind === 'autoplay'
        ? next.fen
        : null
    const canon = (f: string) => f.split(' ').slice(0, 4).join(' ')
    if (fenAfterUser && nextFen && canon(fenAfterUser) !== canon(nextFen)) {
      const reply = findConnectingMove(fenAfterUser, nextFen)
      if (reply) {
        pushHistory({ kind: 'auto', san: reply.san })
        setOppReply({ from: reply.from, to: reply.to })
        if (
          lastBoardFenRef.current &&
          canon(lastBoardFenRef.current) !== canon(fenAfterUser)
        ) {
          setPhaseFen(fenAfterUser)
          advanceTimerRef.current = setTimeout(() => {
            if (engineRef.current !== e) return
            setPhaseFen(null)
            void finishIfDone(next)
          }, replyBeatMs)
          return
        }
      }
    }
    void finishIfDone(next)
  }

  async function consumeAndAdvanceTeach() {
    // phaseFen means the engine already advanced and the board is mid
    // opponent-reply choreography; the visible step is stale.
    if (!engine || !step || phaseFen !== null) return
    let fenAfterUser: string | null = null
    let userMove: { from: string; to: string } | null = null
    if (step.kind === 'teach') {
      markProgress()
      pushHistory({
        kind: 'correct',
        san: step.san,
        ...(step.comment ? { comment: step.comment } : {}),
      })
      fenAfterUser = fenAfterSan(step.fen, step.san)
      userMove = sanToFromTo(step.fen, step.san)
    }
    advanceWithReply(fenAfterUser, userMove)
  }

  async function autoplayAdvance() {
    if (!engine || !step) return
    let fenAfterUser: string | null = null
    let userMove: { from: string; to: string } | null = null
    if (step.kind === 'autoplay') {
      pushHistory({ kind: 'auto', san: step.san })
      fenAfterUser = fenAfterSan(step.fen, step.san)
      userMove = sanToFromTo(step.fen, step.san)
    }
    advanceWithReply(
      fenAfterUser,
      userMove,
      isQuiz ? QUIZ_REPLY_MS : AUTOPLAY_REPLY_MS,
    )
  }

  async function handleQuizMove(played: string) {
    if (!engine || !step || step.kind !== 'quiz' || phaseFen !== null) return
    markProgress()
    const result = engine.submit(played)
    if (result.status === 'retry') {
      missesRef.current.push({
        card_id: Number(step.card_id),
        kind: 'retry',
        played_san: played,
        expected_san: null,
      })
      setBoardTick((t) => t + 1)
      setFeedback({ kind: 'retry', played })
      playWrong()
      setRetryCount((n) => n + 1)
      setTimeout(() => {
        setFeedback({ kind: 'none' })
      }, 700)
      return
    }
    const cardForStep = cardsByIdStr.get(step.card_id)
    const comment = cardForStep?.comment
    if (result.verdict.kind === 'correct') {
      setFeedback({ kind: 'correct', san: result.verdict.san })
      playCorrect()
      pushHistory({
        kind: 'correct',
        san: result.verdict.san,
        ...(comment ? { comment } : {}),
      })
    } else if (result.verdict.kind === 'refutation') {
      playWrong()
      missesRef.current.push({
        card_id: Number(step.card_id),
        kind: 'refutation',
        played_san: played,
        expected_san: null,
      })
      pushHistory({
        kind: 'refutation',
        played,
        continuation: result.verdict.continuation,
        ...(result.verdict.comment ? { comment: result.verdict.comment } : {}),
      })
    } else {
      // wrong (double-fail): reveal and highlight the correct move so the
      // trainee sees what they should have played (PRD D6 / US28).
      const expected =
        result.verdict.kind === 'wrong' ? result.verdict.expected_san : ''
      missesRef.current.push({
        card_id: Number(step.card_id),
        kind: 'double_fail',
        played_san: played,
        expected_san: expected || null,
      })
      setFeedback({ kind: 'reveal-fail', expected, played })
      playWrong()
      pushHistory({
        kind: 'wrong',
        expected,
        played,
        ...(comment ? { comment } : {}),
      })
      setBoardTick((t) => t + 1)
    }
    const wait = result.verdict.kind === 'correct' ? 600 : 900
    // The position after the user's ply: for a double-fail the walk continues
    // along the expected line, so the expected move is the connecting ply.
    const fenAfterUser =
      result.verdict.kind === 'correct'
        ? result.verdict.fen_after
        : result.verdict.kind === 'wrong'
          ? fenAfterSan(step.fen, result.verdict.expected_san)
          : null
    const lastSan =
      result.verdict.kind === 'correct'
        ? result.verdict.san
        : result.verdict.kind === 'wrong'
          ? result.verdict.expected_san
          : null
    const userMove = lastSan ? sanToFromTo(step.fen, lastSan) : null
    const e = engine
    advanceTimerRef.current = setTimeout(() => {
      // Guard against a new line loading mid-animation (stale engine).
      if (engineRef.current !== e) return
      advanceWithReply(fenAfterUser, userMove)
    }, wait)
  }

  useEffect(() => {
    if (!engine || !step || step.kind !== 'autoplay') return
    const delay = isQuiz ? QUIZ_AUTOPLAY_STEP_MS : AUTOPLAY_STEP_MS
    // autoplayAdvance for every mode: it logs the move to the history and
    // runs the user-move → beat → opponent-reply choreography. Routing
    // non-quiz autoplay through consumeAndAdvanceTeach skipped both, so
    // refresher walks jumped a full move-pair per tick.
    const t = setTimeout(() => {
      void autoplayAdvance()
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  useEffect(() => {
    if (!engine || !step || step.kind !== 'refutation-continuation') return
    const frames = expandSanSequence(step.fen, step.continuation)
    const total = frames.length
    if (total === 0 || refutationFrame >= total) {
      const t = setTimeout(() => {
        setOppReply(null)
        engine.advance()
        void finishIfDone(engine.current())
      }, 900)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setRefutationFrame((n) => n + 1)
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, refutationFrame])

  const orientation = useMemo(() => {
    if (!chapter || !step) return 'white' as const
    // Orientation must stay stable across the whole walk — including the
    // 'done' step, where the final position stays on screen under the
    // completion summary. For 'stm' chapters (puzzles) the per-step FEN flips
    // STM on opponent autoplay steps, which would rotate the board mid-walk.
    // Lock orientation to the trainee's side by deriving it from the LINE's
    // starting FEN, not the current step's.
    const fen =
      lineStartFen ??
      (step.kind === 'done'
        ? ''
        : step.kind === 'refutation-continuation'
          ? step.fen
          : ((step as { fen?: string }).fen ?? ''))
    if (!fen) return 'white' as const
    return orientationFor(chapter.user_side, fen)
  }, [chapter, step, lineStartFen])

  if (!chapter || !step)
    return <div className="p-6 text-sm text-ink-muted">Cargando…</div>

  const refutationFrames =
    step.kind === 'refutation-continuation'
      ? expandSanSequence(step.fen, step.continuation)
      : []
  const refutationActive =
    step.kind === 'refutation-continuation' && refutationFrames.length > 0
      ? refutationFrames[Math.min(refutationFrame, refutationFrames.length - 1)]
      : null

  const liveFen =
    step.kind === 'refutation-continuation' && refutationActive
      ? refutationActive.fen_after
      : step.kind === 'quiz' ||
          step.kind === 'autoplay' ||
          step.kind === 'teach' ||
          step.kind === 'refutation-continuation' ||
          step.kind === 'replay'
        ? step.fen
        : null
  // Post-completion review override: while stepping, the board shows the
  // active ply frame; reviewIdx null falls through to the normal
  // final-position view.
  const reviewFrame =
    reviewOffered && reviewIdx !== null
      ? reviewFrames[Math.min(reviewIdx, reviewTotal - 1)]
      : null

  const displayFen =
    reviewFrame?.fen ??
    phaseFen ??
    liveFen ??
    finalFen ??
    lastBoardFenRef.current ??
    ''
  if (displayFen) lastBoardFenRef.current = displayFen

  const showHighlight =
    (reviewFrame !== null && reviewFrame.highlight !== null) ||
    (reviewFrame === null &&
      (step.kind === 'teach' ||
        feedback.kind === 'reveal-fail' ||
        step.kind === 'refutation-continuation' ||
        step.kind === 'replay'))
  const highlightFor = reviewFrame
    ? (reviewFrame.highlight ?? undefined)
    : step.kind === 'teach'
      ? (sanToFromTo(step.fen, step.san) ?? undefined)
      : step.kind === 'quiz' && feedback.kind === 'reveal-fail'
        ? (sanToFromTo(step.fen, feedback.expected) ?? undefined)
        : step.kind === 'refutation-continuation' && refutationActive
          ? (sanToFromTo(refutationActive.fen_before, refutationActive.san) ??
            undefined)
          : step.kind === 'replay'
            ? (sanToFromTo(step.fen, step.san) ?? undefined)
            : undefined

  // Author %cal/%csl annotations: only where the expected move is already
  // visible (teach steps, replay, post-completion review frames, the final
  // position once the line is solved) or deliberately revealed (hint on the
  // current quiz step) — never on an unanswered quiz question.
  const authorShapes = reviewFrame
    ? (reviewFrame.shapes ?? undefined)
    : step.kind === 'teach' || step.kind === 'replay'
      ? step.shapes
      : step.kind === 'quiz' && hintShapes
        ? hintShapes
        : step.kind === 'done'
          ? (reviewFrames[reviewFrames.length - 1]?.shapes ?? undefined)
          : undefined

  const lastMoveForBoard = reviewFrame
    ? (reviewFrame.lastMove ?? undefined)
    : step.kind === 'done'
      ? (finalMove ?? undefined)
      : step.kind === 'refutation-continuation' && refutationActive
        ? (sanToFromTo(refutationActive.fen_before, refutationActive.san) ??
          undefined)
        : (oppReply ?? undefined)

  const completionRing =
    done && completionStats && !isReplay
      ? mode === 'teach'
        ? 'ring-ok'
        : mode === 'refresher'
          ? 'ring-line-strong'
          : OUTCOME_RING[completionStats.outcome]
      : null

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`relative rounded-md transition-shadow duration-300 ${
          completionRing
            ? `ring-4 ${completionRing}`
            : feedback.kind === 'correct'
              ? 'ring-4 ring-ok'
              : feedback.kind === 'retry'
                ? 'ring-4 ring-danger'
                : feedback.kind === 'reveal-fail'
                  ? 'ring-4 ring-accent'
                  : step.kind === 'refutation-continuation'
                    ? 'ring-4 ring-accent/70'
                    : ''
        }`}
        style={{
          width: 'min(100%, calc(100vh - 220px))',
          aspectRatio: '1 / 1',
        }}
      >
        {displayFen && (
          <ChessBoard
            fen={displayFen}
            orientation={orientation}
            revertToken={boardTick}
            highlight={showHighlight ? highlightFor : undefined}
            lastMove={lastMoveForBoard}
            shapes={authorShapes}
            onMove={
              phaseFen !== null
                ? undefined
                : step.kind === 'teach'
                  ? (m) => {
                      if (m.san === step.san) {
                        void consumeAndAdvanceTeach()
                      } else {
                        setBoardTick((t) => t + 1)
                        setFeedback({ kind: 'retry', played: m.san })
                        setTimeout(() => {
                          setFeedback({ kind: 'none' })
                        }, 600)
                      }
                    }
                  : step.kind === 'quiz' && feedback.kind === 'none'
                    ? (m) => {
                        void handleQuizMove(m.san)
                      }
                    : undefined
            }
          />
        )}
      </div>
      <div className="text-center">
        {done && completionStats && !isReplay && (
          <CompletionPanel
            mode={mode}
            stats={completionStats}
            now={new Date()}
            showSolveTime={isChallenge}
            onNavigateNext={onNavigateNext}
            onExit={onExit}
            extraActions={completionExtra}
            reviewControls={
              reviewOffered ? (
                <ReplayControls
                  // Indices walk the ply frames; the last frame is the
                  // resting final position, so ⏭ returns to the completion
                  // view and each ▶ advances exactly one half-move.
                  stepIndex={reviewIdx ?? reviewTotal}
                  totalSteps={reviewTotal + 1}
                  onFirst={() => navReview('first')}
                  onPrev={() => navReview('prev')}
                  onNext={() => navReview('next')}
                  onLast={() => navReview('last')}
                />
              ) : undefined
            }
          />
        )}
        {step.kind === 'autoplay' && (
          <p className="font-mono text-sm text-ink-muted">
            {step.san} <span className="text-xs">(auto)</span>
          </p>
        )}
        {step.kind === 'refutation-continuation' && (
          <p className="text-sm font-medium text-accent">
            Refutation: {step.continuation.join(' ')}
          </p>
        )}
        {step.kind === 'teach' && (
          <>
            <p className="font-mono text-xl font-medium text-ink">{step.san}</p>
            <button
              type="button"
              onClick={() => void consumeAndAdvanceTeach()}
              className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover"
            >
              Got it →
            </button>
          </>
        )}
        {step.kind === 'quiz' && (
          <>
            {feedback.kind === 'none' && (
              <>
                <p className="text-sm text-ink-muted">
                  Your turn — play the move
                  {retryCount > 0 && (
                    <span className="ml-2 text-xs text-accent">
                      (second try)
                    </span>
                  )}
                </p>
                {hintComment !== null
                  ? hintComment !== '' && (
                      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
                        {hintComment}
                      </p>
                    )
                  : // Only offer a hint when there is author content to reveal
                    // (comment and/or shapes) — taking one caps the outcome.
                    (cardsByIdStr.get(step.card_id)?.comment ||
                      cardsByIdStr.get(step.card_id)?.shapes) && (
                      <button
                        type="button"
                        onClick={handleHint}
                        className="mt-2 text-xs text-accent underline decoration-accent/40 underline-offset-2 transition-colors duration-150 hover:text-accent-hover"
                      >
                        Show hint
                      </button>
                    )}
              </>
            )}
            {feedback.kind === 'retry' && (
              <p className="text-sm font-medium text-danger">
                {feedback.played} no — try another
              </p>
            )}
            {feedback.kind === 'correct' && (
              <p className="text-sm font-medium text-ok">✓ {feedback.san}</p>
            )}
            {feedback.kind === 'reveal-fail' && (
              <p className="text-sm font-medium text-accent">
                Incorrect (you played {feedback.played})
                {feedback.expected
                  ? ` — the move was ${feedback.expected}`
                  : ''}
              </p>
            )}
          </>
        )}
        {step.kind === 'replay' && (
          <ReplayControls
            stepIndex={step.stepIndex}
            totalSteps={step.totalSteps}
            onFirst={replayFirst}
            onPrev={replayPrev}
            onNext={replayNext}
            onLast={replayLast}
            label="Replay · Archive"
          />
        )}
      </div>
      {isRefresher && (
        <p className="text-xs italic text-ink-faint">
          Free review — nothing written to SRS.
        </p>
      )}
    </div>
  )
}
