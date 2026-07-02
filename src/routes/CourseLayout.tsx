import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { CourseSidebar } from '../components/CourseSidebar.tsx'
import { CourseTabs } from '../components/CourseTabs.tsx'
import { CommentsPanel } from '../components/CommentsPanel.tsx'
import { SelectionBulkBar } from '../components/SelectionBulkBar.tsx'
import { WalkCore, type ReplayController } from '../components/WalkCore.tsx'
import { resolveTabMode } from '../lib/TabModeResolver.ts'
import { fetchActiveWeakPointCount } from '../lib/WeakPointDeck.ts'
import { resolveCourseEntry } from '../lib/CourseEntryResolver.ts'
import { decideMidWalkExit } from '../lib/MidWalkExitPolicy.ts'
import { formatVariantLabel } from '../lib/VariantLabelFormatter.ts'
import { Toast, ToastViewport } from '../components/Toast.tsx'
import { SidebarSkeleton } from '../components/ui/Skeleton.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { summarizeDay } from '../lib/DailySummary.ts'
import { evaluateNewLinesGate } from '../lib/NewLinesGate.ts'
import { readDailyNewLimit } from '../lib/AppSettings.ts'
import {
  isDailyLimitOverridden,
  overrideDailyLimit,
} from '../lib/DailyLimitOverride.ts'
import { ArchiveUndoBuffer } from '../lib/ArchiveUndoBuffer.ts'
import { SelectionScope } from '../lib/SelectionScope.ts'
import type { CourseSidebarChapter } from '../components/CourseSidebar.tsx'
import type { CourseTab, WalkMode } from '../lib/TabModeResolver.ts'
import type { WalkHistoryEntry } from '../lib/WalkHistory.ts'
import type {
  ArchivedLineEntry,
  ChapterRow,
  PersistedLine,
  PersistedLineState,
  PgnSummary,
} from '../lib/Repository.ts'

function parseTab(value: string | null): CourseTab {
  return value === 'review' ? 'review' : 'learn'
}

interface ToastState {
  message: string
  action?: { label: string; onClick: () => void }
  durationMs?: number
}

function currentScopeIds(
  scope: string | null,
  chapters: CourseSidebarChapter[],
  archivedEntries: ArchivedLineEntry[],
): number[] {
  if (scope === null) return []
  if (scope === 'archive') return archivedEntries.map((e) => e.line.id)
  if (scope === 'singletons:active') {
    const ids: number[] = []
    for (const c of chapters) {
      if (c.lines.length === 1) ids.push(c.lines[0].id)
    }
    return ids
  }
  if (scope.startsWith('chapter:')) {
    const chapterId = Number(scope.slice('chapter:'.length))
    const chapter = chapters.find((c) => c.id === chapterId)
    if (!chapter) return []
    return [...chapter.lines]
      .sort((a, b) => a.dfs_index - b.dfs_index)
      .map((l) => l.id)
  }
  return []
}

export function CourseLayout() {
  const { pgnId, lineId } = useParams<{ pgnId: string; lineId?: string }>()
  const repo = useRepository()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [pgn, setPgn] = useState<PgnSummary | null>(null)
  const [chapters, setChapters] = useState<CourseSidebarChapter[]>([])
  // While the sidebar loads, line states are unknown and resolveTabMode reads
  // every line as "not pending" — gate redirects on this so a valid review
  // URL isn't bounced away by a race.
  const [sidebarLoaded, setSidebarLoaded] = useState(false)
  const [archivedEntries, setArchivedEntries] = useState<ArchivedLineEntry[]>(
    [],
  )
  const [weakPointCount, setWeakPointCount] = useState(0)
  // Challenge-course header stat: clean first-try solves over all attempts.
  const [firstTryStats, setFirstTryStats] = useState<{
    first_try: number
    total: number
  } | null>(null)
  const [now, setNow] = useState(() => new Date())

  // CommentsPanel + WalkCore-side state owned here so the right column reflects
  // walk progress live (history) and the current variant context (chapter,
  // line) without WalkCore needing to render its own panel.
  const [history, setHistory] = useState<WalkHistoryEntry[]>([])
  const [walkChapter, setWalkChapter] = useState<ChapterRow | null>(null)
  const [walkLine, setWalkLine] = useState<PersistedLine | null>(null)
  const [walkInitialFen, setWalkInitialFen] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [autoPickError, setAutoPickError] = useState<string | null>(null)
  const [walkHasProgress, setWalkHasProgress] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const undoBufferRef = useRef<ArchiveUndoBuffer | null>(null)
  if (undoBufferRef.current === null) {
    undoBufferRef.current = new ArchiveUndoBuffer()
  }
  const undoBuffer = undoBufferRef.current

  // Multi-select state. The instance is mutable; `selectionVersion` bumps on
  // every mutation so React re-renders the sidebar and the bulk-bar.
  const selectionRef = useRef<SelectionScope | null>(null)
  if (selectionRef.current === null) {
    selectionRef.current = new SelectionScope()
  }
  const selection = selectionRef.current
  const [selectionVersion, setSelectionVersion] = useState(0)
  function bumpSelection() {
    setSelectionVersion((v) => v + 1)
  }
  const [pendingDelete, setPendingDelete] = useState<{
    lineId: number
    label: string
  } | null>(null)
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{
    ids: number[]
  } | null>(null)
  const [replayController, setReplayController] =
    useState<ReplayController | null>(null)
  const [replayStepIndex, setReplayStepIndex] = useState<number | null>(null)
  const [limitWarn, setLimitWarn] = useState<{
    newToday: number
    dailyLimit: number
  } | null>(null)

  const activeTab = parseTab(searchParams.get('tab'))
  const rawMode = searchParams.get('mode')
  const modeOverride: 'refresh' | 'archive' | null =
    rawMode === 'refresh' ? 'refresh' : rawMode === 'archive' ? 'archive' : null

  async function refreshSidebar() {
    const id = Number(pgnId)
    if (!Number.isFinite(id)) return
    // Re-anchor "due now" on every sidebar refresh; a frozen mount-time clock
    // hides lines that become due during a long session.
    setNow(new Date())
    const summaries = await repo.listPgns()
    const me = summaries.find((s) => s.id === id) ?? null
    setPgn(me)

    // Two PGN-wide queries instead of two per chapter; group in memory.
    const [chapterRows, allLines, allStates] = await Promise.all([
      repo.listChapters(id),
      repo.getLinesForPgn(id),
      repo.getLineStatesForPgn(id),
    ])
    const linesByChapter = new Map<number, PersistedLine[]>()
    for (const l of allLines) {
      const bucket = linesByChapter.get(l.chapter_id)
      if (bucket) bucket.push(l)
      else linesByChapter.set(l.chapter_id, [l])
    }
    const stateByLine = new Map<number, PersistedLineState>(
      allStates.map((s) => [s.line_id, s]),
    )
    const built: CourseSidebarChapter[] = []
    for (const c of chapterRows) {
      const lines = linesByChapter.get(c.id) ?? []
      // Chapter with all variants archived: skip from active sidebar.
      // Its archived variants are still reachable from the 📁 Archivo section.
      if (lines.length === 0) continue
      const stateMap = new Map<number, PersistedLineState>()
      for (const l of lines) {
        const s = stateByLine.get(l.id)
        if (s) stateMap.set(l.id, s)
      }
      built.push({
        id: c.id,
        name: c.name,
        lines,
        lineStates: stateMap,
      })
    }
    setChapters(built)

    const archived = await repo.getArchivedLinesForPgn(id)
    setArchivedEntries(archived)

    // Weak-point badge: positions repeatedly missed in quizzes, excluding
    // those whose every source line is archived. Refreshes with the sidebar,
    // so completing a walk updates it live.
    setWeakPointCount(await fetchActiveWeakPointCount(repo, id))

    // First-try rate for the challenge header; refreshes with the sidebar so
    // each solved exercise updates it live.
    setFirstTryStats(
      me?.is_challenge ? await repo.getFirstTryStatsForPgn(id) : null,
    )
    setSidebarLoaded(true)
  }

  useEffect(() => {
    void refreshSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgnId, repo])

  // Dueness is derived in memory from lineState.due vs the `now` state, so a
  // user idling through a 10-minute learning step would never see the line
  // become due (refreshSidebar only runs on mount and after actions). The
  // heartbeat advances the clock without touching the DB; the per-visit mode
  // pin keeps a tick from flipping an in-progress walk.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // ESC clears any active multi-select. Only attach the listener while there
  // is a selection so we don't compete with other consumers of ESC (modal,
  // overlay) when the feature isn't in use.
  useEffect(() => {
    if (selection.count() === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        selection.clear()
        bumpSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionVersion])

  // Reset right-panel state whenever the active line changes (a fresh variant
  // shouldn't show the previous one's history or chapter intro).
  useEffect(() => {
    setHistory([])
    setWalkLine(null)
    setWalkInitialFen(null)
    setWalkHasProgress(false)
    setReplayStepIndex(null)
  }, [lineId])

  // Banner handed over via navigation state (the root and line routes are
  // separate <Route>s, so CourseLayout remounts across the auto-pick redirect
  // and local toast state would be lost). Only consume it on LINE routes —
  // a banner arriving at the course root (e.g. post-import) must survive the
  // auto-pick redirect, which forwards it. Consume once and clear the history
  // entry so a refresh doesn't replay the banner.
  useEffect(() => {
    if (lineId === undefined) return
    const banner = (location.state as { banner?: string } | null)?.banner
    if (!banner) return
    setToast({ message: banner, durationMs: 4000 })
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, lineId])

  const { totalLines, learnedLines, dueCount, firstLineId } = useMemo(() => {
    let total = 0
    let learned = 0
    let due = 0
    let first: number | null = null
    for (const c of chapters) {
      const sorted = [...c.lines].sort((a, b) => a.dfs_index - b.dfs_index)
      for (const l of sorted) {
        total++
        if (first === null) first = l.id
        const ls = c.lineStates.get(l.id)
        if (ls && ls.state !== 'new') {
          learned++
          if (ls.due.getTime() <= now.getTime()) due++
        }
      }
    }
    return {
      totalLines: total,
      learnedLines: learned,
      dueCount: due,
      firstLineId: first,
    }
  }, [chapters, now])

  const allLearned = totalLines > 0 && learnedLines >= totalLines

  const selectedLineId = lineId ? Number(lineId) : null

  function lineStateFor(id: number): PersistedLineState | null {
    for (const c of chapters) {
      const ls = c.lineStates.get(id)
      if (ls) return ls
    }
    return null
  }

  const archivedLineIds = useMemo(
    () => new Set(archivedEntries.map((e) => e.line.id)),
    [archivedEntries],
  )

  const liveResolvedMode: WalkMode | null = useMemo(() => {
    if (selectedLineId === null) return null
    const result = resolveTabMode({
      tab: activeTab,
      lineState: lineStateFor(selectedLineId),
      modeOverride,
      now,
      isArchived: archivedLineIds.has(selectedLineId),
      isChallenge: pgn?.is_challenge ?? false,
    })
    return result.kind === 'allowed' ? result.mode : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineId, activeTab, modeOverride, chapters, archivedLineIds, pgn])

  // Pin the walk mode for the duration of a line visit. Completing a walk
  // refreshes the sidebar (badge + due dots), which flips the line's dueness
  // mid-display — without the pin, a finished quiz would resolve to null and
  // the dead-end guard would bounce away from the completion summary, and a
  // finished teach would flip to refresher, remounting WalkCore (the mode is
  // part of its key). A null resolution never pins, so the guard's
  // refresh-in-place can still upgrade a stale "not pending" into a quiz.
  const visitKey = `${selectedLineId}:${activeTab}:${modeOverride ?? ''}`
  const pinnedModeRef = useRef<{ key: string; mode: WalkMode } | null>(null)
  let resolvedMode: WalkMode | null
  if (!sidebarLoaded) {
    // Never pin from unloaded data: on a cold deep link the course summary
    // (challenge flag) and line states aren't in yet, and a premature teach
    // pin would leak the solution of a challenge course's new line.
    resolvedMode = null
  } else if (pinnedModeRef.current && pinnedModeRef.current.key === visitKey) {
    resolvedMode = pinnedModeRef.current.mode
  } else if (liveResolvedMode !== null) {
    pinnedModeRef.current = { key: visitKey, mode: liveResolvedMode }
    resolvedMode = liveResolvedMode
  } else {
    pinnedModeRef.current = null
    resolvedMode = null
  }

  // Daily new-lines gate: evaluated when a teach visit starts (never mid-walk
  // — a started variant is never interrupted). "Continuar igual" silences the
  // warning for the rest of the app session.
  useEffect(() => {
    if (resolvedMode !== 'teach' || isDailyLimitOverridden()) {
      setLimitWarn(null)
      return
    }
    let cancelled = false
    void (async () => {
      const now = new Date()
      const dayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      )
      const [activity, dailyLimit] = await Promise.all([
        repo.getReviewActivitySince(dayStart),
        readDailyNewLimit(repo),
      ])
      if (cancelled) return
      const { newToday } = summarizeDay(activity, now)
      const gate = evaluateNewLinesGate({ newToday, dailyLimit })
      setLimitWarn(gate.kind === 'warn' ? gate : null)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineId, resolvedMode, repo])

  function buildLineHref(
    targetLineId: number,
    overrideTab: CourseTab = activeTab,
  ): string | null {
    if (archivedLineIds.has(targetLineId)) {
      return `/pgn/${pgnId}/line/${targetLineId}?mode=archive`
    }
    if (modeOverride === 'refresh') {
      return `/pgn/${pgnId}/line/${targetLineId}?mode=refresh`
    }
    const result = resolveTabMode({
      tab: overrideTab,
      lineState: lineStateFor(targetLineId),
      modeOverride: null,
      now,
    })
    if (result.kind === 'disabled') return null
    return `/pgn/${pgnId}/line/${targetLineId}?tab=${overrideTab}`
  }

  function handleSelectLine(newLineId: number) {
    const href = buildLineHref(newLineId)
    if (!href) return
    if (resolvedMode) {
      const decision = decideMidWalkExit({
        mode: resolvedMode,
        hasProgress: walkHasProgress,
      })
      if (decision.kind === 'warn') {
        const label = abandonedVariantLabel()
        if (label) {
          setToast({ message: `Variante "${label}" no se guardará` })
        } else {
          setToast({ message: 'La variante no se guardará' })
        }
      }
    }
    navigate(href)
  }

  function abandonedVariantLabel(): string | null {
    if (!walkLine || !walkChapter) return null
    const chapterEntry = chapters.find((c) => c.id === walkChapter.id)
    const lineCount = chapterEntry?.lines.length ?? 0
    return formatVariantLabel({
      line: walkLine,
      chapter: { name: walkChapter.name, lineCount },
    })
  }

  function handleSwitchTab(nextTab: CourseTab) {
    if (selectedLineId !== null) {
      const result = resolveTabMode({
        tab: nextTab,
        lineState: lineStateFor(selectedLineId),
        modeOverride: null,
        now,
      })
      if (result.kind === 'allowed') {
        navigate(`/pgn/${pgnId}/line/${selectedLineId}?tab=${nextTab}`, {
          replace: false,
        })
        return
      }
    }
    navigate(`/pgn/${pgnId}?tab=${nextTab}`)
  }

  function isLineDisabledInSidebar(
    _lineId: number,
    lineState: PersistedLineState | null,
  ): boolean {
    if (modeOverride === 'refresh' || modeOverride === 'archive') return false
    if (activeTab !== 'review') return false
    const result = resolveTabMode({
      tab: 'review',
      lineState,
      modeOverride: null,
      now,
    })
    return result.kind === 'disabled'
  }

  function handleRepasarCiclo() {
    if (firstLineId === null) return
    navigate(`/pgn/${pgnId}/line/${firstLineId}?mode=refresh`)
  }

  function labelForActiveLine(targetLineId: number): string {
    for (const c of chapters) {
      const line = c.lines.find((l) => l.id === targetLineId)
      if (line) {
        return formatVariantLabel({
          line,
          chapter: { name: c.name, lineCount: c.lines.length },
        })
      }
    }
    return ''
  }

  function labelForArchivedLine(targetLineId: number): string {
    const entry = archivedEntries.find((e) => e.line.id === targetLineId)
    if (!entry) return ''
    return formatVariantLabel({
      line: entry.line,
      chapter: {
        name: entry.chapter.name,
        lineCount: entry.chapter.total_line_count,
      },
    })
  }

  async function handleArchive(targetLineId: number) {
    const label = labelForActiveLine(targetLineId)
    const wasActive = selectedLineId === targetLineId
    await repo.archiveLine(targetLineId)
    // Navigate FIRST when archiving the active line so the user never sees the
    // "archived placeholder" flash. Queries inside handleNavigateNext run
    // against the freshly-updated DB and correctly skip the archived line.
    if (wasActive) {
      await handleNavigateNext()
    }
    await refreshSidebar()
    undoBuffer.push(
      { kind: 'archive', lineIds: [targetLineId], label },
      Date.now(),
    )
    setToast({
      message: label ? `Variante "${label}" archivada` : 'Variante archivada',
      durationMs: 5000,
      action: {
        label: 'Deshacer',
        onClick: () => void undoArchive(targetLineId),
      },
    })
  }

  async function undoArchive(targetLineId: number) {
    const fresh = undoBuffer.popIfFresh(Date.now())
    if (
      !fresh ||
      fresh.kind !== 'archive' ||
      fresh.lineIds.length !== 1 ||
      fresh.lineIds[0] !== targetLineId
    ) {
      return
    }
    await repo.unarchiveLine(targetLineId)
    await refreshSidebar()
    undoBuffer.clear()
  }

  async function handleBulkArchive() {
    const ids = selection.getIds()
    if (ids.length === 0) return
    const wasActiveInBulk =
      selectedLineId !== null && ids.includes(selectedLineId)
    const warnProgress = wasActiveInBulk && walkHasProgress
    selection.clear()
    bumpSelection()

    // Archive BEFORE navigating so the "next line" queries skip the whole
    // batch — otherwise they can land the user on a line that is about to be
    // archived (same ordering as handleArchive).
    await repo.archiveLines(ids)
    if (wasActiveInBulk) {
      await handleNavigateNext()
    }
    await refreshSidebar()
    const label = `${ids.length} variantes`
    undoBuffer.push({ kind: 'archive', lineIds: ids, label }, Date.now())
    const baseMessage =
      ids.length === 1
        ? '1 variante archivada'
        : `${ids.length} variantes archivadas`
    setToast({
      message: warnProgress
        ? `${baseMessage} · Tu progreso no se guardará`
        : baseMessage,
      durationMs: 5000,
      action: {
        label: 'Deshacer',
        onClick: () => void undoBulkArchive(ids),
      },
    })
  }

  async function undoBulkArchive(targetIds: number[]) {
    const fresh = undoBuffer.popIfFresh(Date.now())
    if (
      !fresh ||
      fresh.kind !== 'archive' ||
      fresh.lineIds.length !== targetIds.length ||
      !targetIds.every((id) => fresh.lineIds.includes(id))
    ) {
      return
    }
    await repo.unarchiveLines(fresh.lineIds)
    await refreshSidebar()
    undoBuffer.clear()
  }

  async function handleBulkRestore() {
    const ids = selection.getIds()
    if (ids.length === 0) return
    selection.clear()
    bumpSelection()
    await repo.unarchiveLines(ids)
    await refreshSidebar()
    const label = `${ids.length} variantes`
    undoBuffer.push({ kind: 'restore', lineIds: ids, label }, Date.now())
    const message =
      ids.length === 1
        ? '1 variante restaurada'
        : `${ids.length} variantes restauradas`
    setToast({
      message,
      durationMs: 5000,
      action: {
        label: 'Deshacer',
        onClick: () => void undoBulkRestore(ids),
      },
    })
  }

  async function undoBulkRestore(targetIds: number[]) {
    const fresh = undoBuffer.popIfFresh(Date.now())
    if (
      !fresh ||
      fresh.kind !== 'restore' ||
      fresh.lineIds.length !== targetIds.length ||
      !targetIds.every((id) => fresh.lineIds.includes(id))
    ) {
      return
    }
    await repo.archiveLines(fresh.lineIds)
    await refreshSidebar()
    undoBuffer.clear()
    // Reverting a bulk restore: leave URL on the course root (mirrors single
    // undoRestore — staying on an archived-line URL resolves to replay mode).
    navigate(`/pgn/${pgnId}`)
  }

  function requestBulkDelete() {
    const ids = selection.getIds()
    if (ids.length === 0) return
    setPendingBulkDelete({ ids })
  }

  async function confirmBulkDelete() {
    if (!pendingBulkDelete) return
    const { ids } = pendingBulkDelete
    const wasActiveInBulk =
      selectedLineId !== null && ids.includes(selectedLineId)
    selection.clear()
    bumpSelection()
    setPendingBulkDelete(null)
    try {
      await repo.deleteLinesHard(ids)
    } catch (err) {
      console.error('deleteLinesHard failed', err)
      await refreshSidebar()
      setToast({ message: 'No se pudieron eliminar las variantes' })
      return
    }
    await refreshSidebar()
    undoBuffer.clear()
    setToast({
      message:
        ids.length === 1
          ? '1 variante eliminada'
          : `${ids.length} variantes eliminadas`,
    })
    if (wasActiveInBulk) {
      navigate(`/pgn/${pgnId}`)
    }
  }

  async function handleRestore(targetLineId: number) {
    const label = labelForArchivedLine(targetLineId)
    await repo.unarchiveLine(targetLineId)
    await refreshSidebar()
    undoBuffer.push(
      { kind: 'restore', lineIds: [targetLineId], label },
      Date.now(),
    )
    setToast({
      message: label ? `Variante "${label}" restaurada` : 'Variante restaurada',
      durationMs: 5000,
      action: {
        label: 'Deshacer',
        onClick: () => void undoRestore(targetLineId),
      },
    })

    // Auto-navigate to the restored variant. Tab depends on whether it has due.
    const id = Number(pgnId)
    if (!Number.isFinite(id)) return
    const state = await repo.getLineState(targetLineId)
    const isDue =
      state !== null &&
      state.state !== 'new' &&
      state.due.getTime() <= Date.now()
    const tab = isDue ? 'review' : 'learn'
    navigate(`/pgn/${pgnId}/line/${targetLineId}?tab=${tab}`)
  }

  async function undoRestore(targetLineId: number) {
    const fresh = undoBuffer.popIfFresh(Date.now())
    if (
      !fresh ||
      fresh.kind !== 'restore' ||
      fresh.lineIds.length !== 1 ||
      fresh.lineIds[0] !== targetLineId
    ) {
      return
    }
    await repo.archiveLine(targetLineId)
    await refreshSidebar()
    undoBuffer.clear()
    // Reverting a restore: leave the URL on a neutral course root rather than
    // staying on a now-archived line URL (which would resolve to replay mode).
    navigate(`/pgn/${pgnId}`)
  }

  function requestDelete(targetLineId: number) {
    const label = labelForArchivedLine(targetLineId)
    setPendingDelete({ lineId: targetLineId, label })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const { lineId: targetLineId } = pendingDelete
    const wasActive = selectedLineId === targetLineId
    setPendingDelete(null)
    try {
      await repo.deleteLineHard(targetLineId)
    } catch (err) {
      console.error('deleteLineHard failed', err)
      await refreshSidebar()
      setToast({ message: 'No se pudo eliminar la variante' })
      return
    }
    await refreshSidebar()
    // No undo for hard delete — the toast is informational only.
    undoBuffer.clear()
    setToast({ message: 'Variante eliminada' })
    if (wasActive) {
      navigate(`/pgn/${pgnId}`)
    }
  }

  // Auto-redirect when no lineId in URL: pick best entry and canonicalize URL.
  useEffect(() => {
    if (selectedLineId !== null) return
    const id = Number(pgnId)
    if (!Number.isFinite(id)) {
      setAutoPickError('PGN inválido')
      return
    }
    let cancelled = false
    void (async () => {
      const [nextLearn, nextDue] = await Promise.all([
        repo.getNextLearnLineForPgn(id),
        repo.getNextDueLineForPgn(id, new Date()),
      ])
      let firstLine: { line_id: number } | null = null
      if (!nextLearn && !nextDue) {
        const chs = await repo.listChapters(id)
        const firstChapter = chs[0]
        if (firstChapter) {
          const lines = await repo.getLinesForChapter(firstChapter.id)
          const first = lines[0]
          if (first) firstLine = { line_id: first.id }
        }
      }
      const redirect = resolveCourseEntry({
        tab:
          searchParams.get('tab') === 'review'
            ? 'review'
            : searchParams.get('tab') === 'learn'
              ? 'learn'
              : null,
        nextLearn,
        nextDue,
        firstLine,
      })
      if (cancelled) return
      if (redirect) {
        // The user asked for Repasar but the fallback moved them elsewhere:
        // announce the automatic tab switch with a one-line banner. Manual
        // tab changes never come through here with a mismatched query.
        const wantedReview = searchParams.get('tab') === 'review'
        // An incoming banner (post-import handoff) wins over the auto-pick's
        // own tab-switch announcements.
        const incomingBanner = (location.state as { banner?: string } | null)
          ?.banner
        const banner =
          incomingBanner ??
          (wantedReview && redirect.query === '?tab=learn'
            ? 'Sin repasos pendientes — hora de aprender variantes nuevas'
            : wantedReview && redirect.query === '?mode=refresh'
              ? 'Sin repasos ni variantes nuevas — repaso libre'
              : null)
        navigate(`/pgn/${pgnId}/line/${redirect.lineId}${redirect.query}`, {
          replace: true,
          ...(banner ? { state: { banner } } : {}),
        })
        return
      }
      setAutoPickError('Este curso no tiene contenido para entrenar.')
    })()
    return () => {
      cancelled = true
    }
  }, [pgnId, selectedLineId, searchParams, repo, navigate])

  // Dead-end guard: a line URL the active tab can't walk (a not-due line
  // under ?tab=review) used to render a static "not pending" card. Bounce to
  // the course root instead so the entry auto-pick picks the next due line,
  // falls back to Aprender, or free refresher.
  useEffect(() => {
    if (!sidebarLoaded || selectedLineId === null || resolvedMode !== null) {
      return
    }
    const id = Number(pgnId)
    if (!Number.isFinite(id)) return
    let cancelled = false
    void (async () => {
      // The sidebar clock is anchored at its last refresh, so a line that
      // became due mid-session can read "not pending" here while the DB says
      // due — bouncing would loop (the root auto-pick sends us right back).
      // Re-check against the DB and refresh in place in that case.
      const due = await repo.getNextDueLineForPgn(id, new Date())
      if (cancelled) return
      if (due && due.line_id === selectedLineId) {
        await refreshSidebar()
        return
      }
      navigate(`/pgn/${pgnId}?tab=${activeTab}`, { replace: true })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarLoaded, selectedLineId, resolvedMode, activeTab, pgnId, repo])

  async function handleNavigateNext() {
    const id = Number(pgnId)
    if (!Number.isFinite(id)) return
    if (modeOverride === 'refresh') {
      // Cycle refresher: advance to the next line by dfs order within the PGN.
      if (selectedLineId === null) return
      const sortedAll: { line_id: number }[] = []
      for (const c of chapters) {
        const sorted = [...c.lines].sort((a, b) => a.dfs_index - b.dfs_index)
        for (const l of sorted) sortedAll.push({ line_id: l.id })
      }
      const idx = sortedAll.findIndex((l) => l.line_id === selectedLineId)
      const next = idx >= 0 ? sortedAll[idx + 1] : undefined
      if (next) {
        navigate(`/pgn/${pgnId}/line/${next.line_id}?mode=refresh`)
        return
      }
      navigate(`/pgn/${pgnId}`)
      return
    }

    if (activeTab === 'review') {
      const due = await repo.getNextDueLineForPgn(id, new Date())
      if (due && due.line_id !== selectedLineId) {
        navigate(`/pgn/${pgnId}/line/${due.line_id}?tab=review`)
        return
      }
      navigate(`/pgn/${pgnId}?tab=review`)
      return
    }
    // learn tab
    const learn = await repo.getNextLearnLineForPgn(id)
    if (learn && learn.line_id !== selectedLineId) {
      navigate(`/pgn/${pgnId}/line/${learn.line_id}?tab=learn`)
      return
    }
    navigate(`/pgn/${pgnId}?tab=learn`)
  }

  function handleExit() {
    navigate('/')
  }

  const chapterForLine = useMemo(() => {
    if (selectedLineId === null) return null
    for (const c of chapters) {
      if (c.lines.some((l) => l.id === selectedLineId)) return c
    }
    return null
  }, [chapters, selectedLineId])

  const chapterLineCount = chapterForLine?.lines.length ?? 0
  const inArchiveReplay = resolvedMode === 'replay'
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="border-b border-line p-2">
          {inArchiveReplay ? (
            <button
              type="button"
              onClick={() => navigate(`/pgn/${pgnId}`)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-surface-3"
            >
              <span>←</span>
              <span className="min-w-0 flex-1 truncate">Archivo · cerrar</span>
            </button>
          ) : (
            <CourseTabs
              activeTab={activeTab}
              dueCount={dueCount}
              onChange={handleSwitchTab}
            />
          )}
        </div>
        {!sidebarLoaded ? (
          <SidebarSkeleton />
        ) : (
          <CourseSidebar
            chapters={chapters}
            archivedEntries={archivedEntries}
            selectedLineId={selectedLineId}
            now={now}
            onSelectLine={handleSelectLine}
            onArchive={(id) => void handleArchive(id)}
            onRestore={(id) => void handleRestore(id)}
            onDelete={requestDelete}
            isLineDisabled={isLineDisabledInSidebar}
            selection={selection}
            selectionVersion={selectionVersion}
            onMutate={bumpSelection}
          />
        )}
        {selection.count() > 0 &&
          (() => {
            const scope = selection.getScope()
            const scopeIds = currentScopeIds(scope, chapters, archivedEntries)
            const allSelected =
              scopeIds.length > 0 && selection.count() >= scopeIds.length
            const toggleAllAction =
              scopeIds.length > 0
                ? {
                    label: allSelected ? 'Ninguna' : 'Todas',
                    onClick: () => {
                      if (allSelected) {
                        selection.selectNone()
                      } else if (scope !== null) {
                        selection.selectAll({
                          scopeKey: scope,
                          orderedIdsInScope: scopeIds,
                        })
                      }
                      bumpSelection()
                    },
                  }
                : null
            const bulkActions =
              scope === 'archive'
                ? [
                    {
                      label: 'Restaurar',
                      onClick: () => void handleBulkRestore(),
                    },
                    {
                      label: 'Eliminar perm.',
                      onClick: () => requestBulkDelete(),
                      danger: true,
                    },
                  ]
                : scope?.startsWith('chapter:') || scope === 'singletons:active'
                  ? [
                      {
                        label: 'Archivar',
                        onClick: () => void handleBulkArchive(),
                      },
                    ]
                  : []
            if (bulkActions.length === 0) return null
            const actions = toggleAllAction
              ? [toggleAllAction, ...bulkActions]
              : bulkActions
            return (
              <SelectionBulkBar
                count={selection.count()}
                actions={actions}
                onCancel={() => {
                  selection.clear()
                  bumpSelection()
                }}
              />
            )
          })()}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface-1 px-4 py-2">
          <Link
            to="/"
            className="text-sm text-ink-muted hover:text-ink hover:underline"
          >
            ← Biblioteca
          </Link>
          {pgn && (
            <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
              <span>{pgn.name}</span>
              {pgn.is_challenge && (
                <span
                  className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs text-accent"
                  title="Curso de reto: las posiciones nuevas se preguntan a ciegas"
                >
                  ⚡ Reto
                  {firstTryStats && firstTryStats.total > 0 && (
                    <>
                      {' '}
                      · a la primera{' '}
                      {Math.round(
                        (firstTryStats.first_try / firstTryStats.total) * 100,
                      )}
                      %
                    </>
                  )}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {weakPointCount > 0 && (
              <button
                type="button"
                onClick={() => navigate(`/pgn/${pgnId}/puzzles`)}
                className="rounded border border-line-strong px-2 py-1 text-xs text-ink-muted hover:bg-surface-3"
                title="Puzzles de las posiciones donde más fallas — no escribe en SRS"
              >
                🎯 Puntos débiles ({weakPointCount})
              </button>
            )}
            {allLearned && modeOverride !== 'refresh' && (
              <button
                type="button"
                onClick={handleRepasarCiclo}
                className="rounded border border-line-strong px-2 py-1 text-xs text-ink-muted hover:bg-surface-3"
                title="Repaso libre del PGN — sin escribir en SRS"
              >
                ↻ Repasar ciclo
              </button>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {selectedLineId === null ? (
            autoPickError ? (
              archivedEntries.length > 0 ? (
                <div className="mx-auto max-w-md rounded-lg border border-line bg-surface-1 p-6 text-center">
                  <h2 className="text-lg font-medium text-ink">
                    No hay variantes activas
                  </h2>
                  <p className="mt-2 text-sm text-ink-muted">
                    Todas las variantes de este curso están archivadas. Restaura
                    alguna desde la sección <strong>📁 Archivo</strong> del
                    sidebar.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">{autoPickError}</p>
              )
            ) : (
              <p className="text-sm text-ink-muted">Cargando…</p>
            )
          ) : resolvedMode === null ? (
            // Transient: the dead-end guard effect is about to bounce this
            // URL to the course root (or refresh a stale sidebar clock).
            <p className="text-sm text-ink-muted">Cargando…</p>
          ) : (
            <WalkCore
              key={`${selectedLineId}:${resolvedMode}`}
              lineId={selectedLineId}
              mode={resolvedMode}
              isChallenge={pgn?.is_challenge ?? false}
              // Next-step offer for the moment the review queue empties; never
              // shown mid-session (dueCount > 0 keeps it null).
              completionExtra={
                resolvedMode === 'quiz' && dueCount === 0 ? (
                  weakPointCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/pgn/${pgnId}/puzzles`)}
                      className="rounded-md border border-line-strong px-3 py-2 text-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2"
                    >
                      🎯 Entrenar puntos débiles ({weakPointCount})
                    </button>
                  ) : allLearned ? (
                    <button
                      type="button"
                      onClick={handleRepasarCiclo}
                      className="rounded-md border border-line-strong px-3 py-2 text-sm text-ink-muted transition-colors duration-150 hover:bg-surface-2"
                    >
                      ↻ Repasar ciclo
                    </button>
                  ) : null
                ) : null
              }
              // Refresh badge + due dots the moment the SRS write lands; the
              // pinned mode above keeps this walk's mount stable through it.
              onComplete={() => void refreshSidebar()}
              onHistoryChange={setHistory}
              onChapterChange={setWalkChapter}
              onLineLoad={setWalkLine}
              onInitialFen={setWalkInitialFen}
              onProgressChange={setWalkHasProgress}
              onNavigateNext={() => void handleNavigateNext()}
              onExit={handleExit}
              onReplayController={setReplayController}
              onReplayStepChange={(i) => setReplayStepIndex(i)}
            />
          )}
        </main>
      </div>
      <CommentsPanel
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((c) => !c)}
        chapter={walkChapter}
        line={walkLine}
        chapterLineCount={chapterLineCount}
        mode={resolvedMode}
        initialFen={walkInitialFen}
        history={history}
        currentReplayIndex={replayStepIndex}
        onJumpToReplay={
          replayController ? (i) => replayController.jumpTo(i) : undefined
        }
      />
      <ToastViewport>
        {toast && (
          <Toast
            message={toast.message}
            action={toast.action}
            durationMs={toast.durationMs}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastViewport>
      {pendingDelete && (
        <ConfirmDialog
          variant="danger"
          title="Eliminar variante permanentemente"
          body={`Esta acción no se puede deshacer. La variante "${pendingDelete.label}" y todo su historial de aprendizaje se eliminarán para siempre.`}
          confirmLabel="Eliminar para siempre"
          cancelLabel="Cancelar"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {limitWarn && (
        <ConfirmDialog
          title="Límite diario alcanzado"
          body={`Hoy ya aprendiste ${limitWarn.newToday} variantes nuevas (tu límite es ${limitWarn.dailyLimit}). El SRS te las cobrará en los próximos días. Puedes continuar igual o volver mañana.`}
          confirmLabel="Continuar igual"
          cancelLabel="Volver a la biblioteca"
          onConfirm={() => {
            overrideDailyLimit()
            setLimitWarn(null)
          }}
          onCancel={() => {
            setLimitWarn(null)
            navigate('/')
          }}
        />
      )}
      {pendingBulkDelete && (
        <ConfirmDialog
          variant="danger"
          title={`Eliminar ${pendingBulkDelete.ids.length} variantes permanentemente`}
          body={`Esta acción no se puede deshacer. ${pendingBulkDelete.ids.length} variantes y todo su historial de aprendizaje se eliminarán para siempre.`}
          confirmLabel="Eliminar para siempre"
          cancelLabel="Cancelar"
          onConfirm={() => void confirmBulkDelete()}
          onCancel={() => setPendingBulkDelete(null)}
        />
      )}
    </div>
  )
}
