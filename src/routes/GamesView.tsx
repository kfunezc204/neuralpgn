import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  Swords,
  Target,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  User,
} from 'lucide-react'
import { useRepository } from '../lib/RepositoryContext.tsx'
import { ChessBoard } from '../components/ChessBoard.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { buttonClasses } from '../components/ui/Button.tsx'
import { MoveNotationStrip } from '../components/MoveNotationStrip.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { formatTimeControl, parseGamesPgn } from '../lib/GamePgnParser.ts'
import { analyzeGame } from '../lib/DeviationDetector.ts'
import type { DetectedDeviation } from '../lib/DeviationDetector.ts'
import {
  buildRepertoireIndex,
  loadCourseSources,
} from '../lib/RepertoireIndex.ts'
import { expandSanSequence, sanToFromTo } from '../lib/MoveResolver.ts'
import { ReplayControls } from '../components/ReplayControls.tsx'
import { PendingDeviationsResolver } from '../lib/PendingDeviationsResolver.ts'
import {
  readGameCheckUsername,
  readLichessLastSync,
  writeGameCheckUsername,
  writeLichessLastSync,
} from '../lib/AppSettings.ts'
import {
  fetchUserGames,
  GamesDownloadError,
} from '../lib/LichessGamesClient.ts'
import type { ImportedGameRow, NewImportedGame } from '../lib/Repository.ts'

interface DeviationRow {
  key: string
  game: ImportedGameRow
  deviation: DetectedDeviation
}

/** Full analysis of one stored game against the current repertoire. */
interface GameAnalysisEntry {
  deviations: DetectedDeviation[]
  matched: number
}

interface ImportSummary {
  new_games: number
  duplicates: number
  deviations: number
  /** Deviations in this batch the user already drilled/dismissed — they stay
   * resolved forever, which is why a re-import can show an empty list. */
  resolved_earlier: number
  /** Games in this batch with book coverage and zero deviations. */
  in_book: number
  /** Standard games in this batch that never touched the repertoire. */
  uncovered: number
  skipped_variants: number
  skipped_unknown_player: number
}

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** Games per page in the archive tab. */
const GAMES_PAGE_SIZE = 20

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function formatRelativeSync(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return d.toLocaleDateString()
}

function describeSyncError(err: unknown): string {
  if (err instanceof GamesDownloadError) {
    switch (err.kind) {
      case 'user-not-found':
        return 'That Lichess user does not exist. Check the player name.'
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

/** Side-you-played marker — a CSS dot renders identically on every platform,
 * unlike the ⚪/⚫ emoji it replaces. */
function ColorDot({ color }: { color: 'white' | 'black' }) {
  return (
    <span
      title={`You played ${color}`}
      className={`inline-block h-2.5 w-2.5 rounded-full align-[-1px] ${
        color === 'white' ? 'bg-ink' : 'border border-line-strong bg-surface-0'
      }`}
    />
  )
}

function GameMetaLine({ game }: { game: ImportedGameRow }) {
  return (
    <span>
      {formatDate(game.played_at)} · {formatTimeControl(game.time_control)} ·{' '}
      <ColorDot color={game.user_color} /> {game.white} — {game.black} (
      {game.result})
    </span>
  )
}

/**
 * Board + replay + clickable notation for one stored game, with every
 * deviation painted red. Shared by the pending-deviations tab and the games
 * archive; parents reset it via `key` when the subject changes.
 */
function GameAnalysisPanel({
  game,
  deviations,
  anchorCursor,
  actions,
}: {
  game: ImportedGameRow
  deviations: DetectedDeviation[]
  /** Cursor the panel opens at and "↩ Deviation" returns to. */
  anchorCursor: number
  /** Rendered inside the verdict card — e.g. Drill/Dismiss for the pending
   * deviation this panel is showing. */
  actions?: ReactNode
}) {
  const [rawCursor, setRawCursor] = useState(anchorCursor)
  const replay = useMemo(
    () => expandSanSequence(INITIAL_FEN, game.sans),
    [game],
  )
  const cursor = Math.min(rawCursor, replay.length)
  const fenAtCursor = cursor === 0 ? INITIAL_FEN : replay[cursor - 1].fen_after
  const atAnchor = cursor === anchorCursor

  // Cursor sits on the position BEFORE ply p when cursor === p - 1.
  const activeDeviation = deviations.find((d) => d.ply - 1 === cursor) ?? null
  const deviationPlies = useMemo(
    () => new Set(deviations.map((d) => d.ply)),
    [deviations],
  )

  // The expected-move arrow only means something on a deviation position;
  // elsewhere the board shows the last real move instead.
  const highlight = useMemo(() => {
    if (!activeDeviation) return undefined
    const primary = activeDeviation.expected[0]
    return sanToFromTo(activeDeviation.fen_before, primary.san) ?? undefined
  }, [activeDeviation])
  const lastMove = useMemo(() => {
    if (cursor === 0) return undefined
    const step = replay[cursor - 1]
    return sanToFromTo(step.fen_before, step.san) ?? undefined
  }, [replay, cursor])

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
      <div>
        {/* Same viewport-driven sizing as the Learn/Review walk board, so the
            board reads as the same instrument across the app. */}
        <div
          className="mx-auto"
          style={{
            width: 'min(100%, calc(100vh - 240px))',
            aspectRatio: '1 / 1',
          }}
        >
          <ChessBoard
            fen={fenAtCursor}
            orientation={game.user_color}
            highlight={highlight}
            lastMove={lastMove}
          />
        </div>
        {/* Symmetric 1fr side columns keep the replay buttons exactly centered
            under the board; the Deviation jump sits beside them in the right
            column without ever pushing them off-center. */}
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          <span />
          <ReplayControls
            stepIndex={cursor}
            totalSteps={replay.length + 1}
            onFirst={() => setRawCursor(0)}
            onPrev={() => setRawCursor((c) => Math.max(0, c - 1))}
            onNext={() => setRawCursor((c) => Math.min(replay.length, c + 1))}
            onLast={() => setRawCursor(replay.length)}
          />
          {/* Always rendered so it never reflows when it appears; merely
              invisible while ON the anchor (or when there is none). */}
          <button
            type="button"
            onClick={() => setRawCursor(anchorCursor)}
            disabled={atAnchor || deviations.length === 0}
            title="Jump back to the position where you left book"
            className={`${buttonClasses({
              variant: 'secondary',
              size: 'sm',
            })} mt-0.5 justify-self-start ${atAnchor || deviations.length === 0 ? 'invisible' : ''}`}
          >
            <Undo2 className="h-3.5 w-3.5" /> Deviation
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface-1 p-4">
        <p className="text-xs text-ink-muted">
          <GameMetaLine game={game} />
        </p>
        <div className="my-3 border-t border-line" />
        {/* Verdict ABOVE the notation: it's the payload of the panel and must
            never be pushed below the fold by a long game's move list. */}
        {activeDeviation ? (
          <>
            <div className="rounded-md border-l-2 border-accent bg-accent-soft px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Left book at move {activeDeviation.move_number}
              </p>
              <p className="mt-1.5 text-sm">
                <span className="text-ink-muted">Book:</span>{' '}
                <span className="font-mono font-semibold text-accent">
                  {activeDeviation.expected.map((m) => m.san).join(' / ')}
                </span>
              </p>
              <p className="mt-0.5 text-sm">
                <span className="text-ink-muted">You played:</span>{' '}
                <span className="font-mono font-semibold text-danger">
                  {activeDeviation.played_san}
                </span>
              </p>
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              From “{activeDeviation.expected[0].pgn_name}” ·{' '}
              <Link
                to={`/pgn/${activeDeviation.expected[0].pgn_id}/line/${activeDeviation.expected[0].line_id}`}
                state={{ fromGameCheck: true }}
                className="text-accent underline-offset-2 hover:underline"
              >
                View line in course →
              </Link>
            </p>
          </>
        ) : deviations.length > 0 ? (
          <p className="text-sm text-ink-faint">
            Browsing the game — deviation
            {deviations.length === 1 ? '' : 's'} at move{' '}
            {deviations.map((d) => d.move_number).join(', ')} (red in the
            notation).
          </p>
        ) : (
          <p className="text-sm text-ink-faint">
            No deviations in this game against your current repertoire.
          </p>
        )}
        {actions && <div className="mt-3 flex gap-2">{actions}</div>}
        <div className="mt-3">
          <MoveNotationStrip
            sans={game.sans}
            cursor={cursor}
            deviationPlies={deviationPlies}
            onSelect={setRawCursor}
          />
        </div>
      </div>
    </div>
  )
}

export function GamesView() {
  const repo = useRepository()
  const [username, setUsername] = useState('')
  const [usernameLoaded, setUsernameLoaded] = useState(false)
  const [tab, setTab] = useState<'deviations' | 'games'>('deviations')
  const [games, setGames] = useState<ImportedGameRow[]>([])
  const [analyses, setAnalyses] = useState<Map<number, GameAnalysisEntry>>(
    new Map(),
  )
  const [rows, setRows] = useState<DeviationRow[]>([])
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [gamesPage, setGamesPage] = useState(0)
  const [pendingDeleteGame, setPendingDeleteGame] =
    useState<ImportedGameRow | null>(null)
  const [checkedGameIds, setCheckedGameIds] = useState<Set<number>>(new Set())
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lastSync, setLastSync] = useState<Date | null>(null)

  // This session's verdicts, for the wrap-up panel once the list empties:
  // drilled positions per course (so we can link straight to each course's
  // puzzle session) plus how many were dismissed.
  const [drilledByCourse, setDrilledByCourse] = useState<
    Map<number, { name: string; count: number }>
  >(new Map())
  const [dismissedCount, setDismissedCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      readGameCheckUsername(repo),
      readLichessLastSync(repo),
    ]).then(([u, sync]) => {
      if (cancelled) return
      if (u) setUsername(u)
      setLastSync(sync)
      setUsernameLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [repo])

  /** Analyze every stored game against the current repertoire — the plan's
   * "never persist deviations" rule: a new/deleted course or an archive
   * change is reflected on the next recompute with zero migration work. */
  const recompute = useCallback(async () => {
    const [allGames, sources, actions] = await Promise.all([
      repo.listImportedGames(),
      loadCourseSources(repo),
      repo.listDeviationActions(),
    ])
    const index = buildRepertoireIndex(sources)
    const resolver = new PendingDeviationsResolver(actions)

    const analysesMap = new Map<number, GameAnalysisEntry>()
    const newRows: DeviationRow[] = []
    for (const game of allGames) {
      const analysis = analyzeGame(
        { sans: game.sans, user_color: game.user_color },
        index,
      )
      analysesMap.set(game.id, {
        deviations: analysis.deviations,
        matched: analysis.matched_move_count,
      })
      for (const deviation of analysis.deviations) {
        const pending = resolver.isPending(
          game.id,
          deviation.played_san,
          deviation.expected.map((m) => m.card_id),
        )
        if (!pending) continue
        newRows.push({ key: `${game.id}:${deviation.ply}`, game, deviation })
      }
    }

    setGames(allGames)
    setAnalyses(analysesMap)
    setRows(newRows)
    setSelectedKey((prev) =>
      prev && newRows.some((r) => r.key === prev)
        ? prev
        : (newRows[0]?.key ?? null),
    )
    setSelectedGameId((prev) =>
      prev !== null && allGames.some((g) => g.id === prev)
        ? prev
        : (allGames[0]?.id ?? null),
    )
    // Prune checkboxes pointing at games that no longer exist.
    setCheckedGameIds((prev) => {
      const alive = new Set(allGames.map((g) => g.id))
      return new Set([...prev].filter((id) => alive.has(id)))
    })
  }, [repo])

  useEffect(() => {
    let cancelled = false
    void recompute()
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [recompute])

  /** Shared ingest pipeline: PGN files and Lichess syncs land here alike. */
  async function ingestPgnText(pgnText: string, source: 'lichess' | 'pgn') {
    const player = username.trim()
    const parsed = parseGamesPgn(pgnText, player)

    const s: ImportSummary = {
      new_games: 0,
      duplicates: 0,
      deviations: 0,
      resolved_earlier: 0,
      in_book: 0,
      uncovered: 0,
      skipped_variants: 0,
      skipped_unknown_player: 0,
    }
    const toSave: NewImportedGame[] = []
    for (const g of parsed) {
      if (!g.is_standard) {
        s.skipped_variants++
        continue
      }
      if (!g.user_color) {
        s.skipped_unknown_player++
        continue
      }
      toSave.push({
        dedupe_key: g.dedupe_key,
        source,
        site_url: g.site_url,
        played_at: g.played_at,
        white: g.white,
        black: g.black,
        user_color: g.user_color,
        result: g.result,
        time_control: g.time_control,
        sans: g.sans,
        pgn_text: g.pgn_text,
      })
    }
    s.new_games = await repo.saveImportedGames(toSave)
    s.duplicates = toSave.length - s.new_games

    // Batch-level outcome counts for the summary line. Duplicates are
    // re-analyzed too: a re-import must report what the file contains, and
    // separately how much of it was already resolved (drilled/dismissed
    // deviations never come back — that's the resolver's contract).
    const [index, savedGames, actions] = await Promise.all([
      loadCourseSources(repo).then(buildRepertoireIndex),
      repo.listImportedGames(),
      repo.listDeviationActions(),
    ])
    const gameIdByKey = new Map(savedGames.map((g) => [g.dedupe_key, g.id]))
    const resolver = new PendingDeviationsResolver(actions)
    for (const g of toSave) {
      const analysis = analyzeGame(
        { sans: g.sans, user_color: g.user_color },
        index,
      )
      if (analysis.deviations.length > 0) {
        s.deviations += analysis.deviations.length
        const gameId = gameIdByKey.get(g.dedupe_key)
        if (gameId !== undefined) {
          s.resolved_earlier += analysis.deviations.filter(
            (d) =>
              !resolver.isPending(
                gameId,
                d.played_san,
                d.expected.map((m) => m.card_id),
              ),
          ).length
        }
      } else if (analysis.matched_move_count > 0) {
        s.in_book++
      } else {
        s.uncovered++
      }
    }
    setSummary(s)
    await recompute()
  }

  function requirePlayer(): string | null {
    const player = username.trim()
    if (!player) {
      setError(
        'Set your player name first — it identifies your side in each game.',
      )
      return null
    }
    return player
  }

  async function importPgnText(pgnText: string) {
    const player = requirePlayer()
    if (!player) return
    setAnalyzing(true)
    setError(null)
    try {
      await writeGameCheckUsername(repo, player)
      await ingestPgnText(pgnText, 'pgn')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSync() {
    const player = requirePlayer()
    if (!player) return
    setAnalyzing(true)
    setError(null)
    // Games played while the sync runs must not fall between two syncs:
    // the next `since` is this sync's start, and dedupe absorbs the overlap.
    const syncStart = new Date()
    try {
      await writeGameCheckUsername(repo, player)
      const pgnText = await fetchUserGames(
        player,
        lastSync ? { since: lastSync } : {},
        (url) => fetch(url),
      )
      await ingestPgnText(pgnText, 'lichess')
      await writeLichessLastSync(repo, syncStart)
      setLastSync(syncStart)
    } catch (err) {
      setError(describeSyncError(err))
    } finally {
      setAnalyzing(false)
    }
  }

  /** Drill: persist the verdict, and only when it's NEW feed the weak-point
   * deck — pressing Drill twice can never double-count a miss. */
  async function handleDrill(row: DeviationRow) {
    const primary = row.deviation.expected[0]
    try {
      const isNew = await repo.recordDeviationAction({
        game_id: row.game.id,
        card_id: primary.card_id,
        played_san: row.deviation.played_san,
        action: 'sent',
      })
      if (isNew) {
        await repo.recordMoveMisses([
          {
            card_id: primary.card_id,
            line_id: primary.line_id,
            ts: new Date(),
            kind: 'game_deviation',
            played_san: row.deviation.played_san,
            expected_san: primary.san,
          },
        ])
        setDrilledByCourse((prev) => {
          const next = new Map(prev)
          const entry = next.get(primary.pgn_id)
          next.set(primary.pgn_id, {
            name: primary.pgn_name,
            count: (entry?.count ?? 0) + 1,
          })
          return next
        })
      }
      await recompute()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDismiss(row: DeviationRow) {
    const primary = row.deviation.expected[0]
    try {
      const isNew = await repo.recordDeviationAction({
        game_id: row.game.id,
        card_id: primary.card_id,
        played_san: row.deviation.played_san,
        action: 'dismissed',
      })
      if (isNew) setDismissedCount((n) => n + 1)
      await recompute()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await importPgnText(await file.text())
  }

  async function confirmDeleteGame() {
    if (!pendingDeleteGame) return
    const { id } = pendingDeleteGame
    setPendingDeleteGame(null)
    try {
      await repo.deleteImportedGame(id)
      await recompute()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function confirmBulkDelete() {
    const ids = [...checkedGameIds]
    setPendingBulkDelete(false)
    if (ids.length === 0) return
    try {
      await repo.deleteImportedGames(ids)
      await recompute()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggleGameChecked(id: number) {
    setCheckedGameIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selected = useMemo(
    () => rows.find((r) => r.key === selectedKey) ?? null,
    [rows, selectedKey],
  )
  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) ?? null,
    [games, selectedGameId],
  )
  // Clamp instead of resetting so deleting the last game of the last page
  // lands on the new last page.
  const gamesTotalPages = Math.max(1, Math.ceil(games.length / GAMES_PAGE_SIZE))
  const currentGamesPage = Math.min(gamesPage, gamesTotalPages - 1)
  const pagedGames = useMemo(
    () =>
      games.slice(
        currentGamesPage * GAMES_PAGE_SIZE,
        (currentGamesPage + 1) * GAMES_PAGE_SIZE,
      ),
    [games, currentGamesPage],
  )
  const drilledTotal = [...drilledByCourse.values()].reduce(
    (n, c) => n + c.count,
    0,
  )

  return (
    <main className="view-enter mx-auto max-w-[1520px] px-6 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Game Check</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Compare your real games against your repertoire and find where you
            left book.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <div className="relative">
              <User className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your player name"
                aria-label="Your player name"
                title="Your name in the games — identifies your side"
                disabled={!usernameLoaded}
                className="w-44 rounded-md border border-line-strong bg-surface-2 py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={analyzing}
              title="Download your latest Lichess games and check them"
              className={buttonClasses({ variant: 'primary' })}
            >
              {analyzing ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Working…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Sync Lichess
                </>
              )}
            </button>
            <label className="inline-block">
              <span
                className={`${buttonClasses({
                  variant: 'secondary',
                  disabled: analyzing,
                })} ${analyzing ? '' : 'cursor-pointer'}`}
              >
                <Upload className="h-4 w-4" /> Import PGN
              </span>
              <input
                type="file"
                accept=".pgn"
                onChange={(e) => void handleFile(e)}
                disabled={analyzing}
                className="hidden"
              />
            </label>
          </div>
          {lastSync && (
            <p className="text-xs text-ink-faint">
              Last sync {formatRelativeSync(lastSync)}
            </p>
          )}
        </div>
      </header>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {summary &&
        summary.new_games === 0 &&
        summary.duplicates > 0 &&
        summary.skipped_variants === 0 &&
        summary.skipped_unknown_player === 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
            <TriangleAlert
              className="h-4 w-4 shrink-0 text-accent"
              aria-hidden="true"
            />
            <p className="font-medium text-accent">
              These games were already imported — nothing new was added.
            </p>
          </div>
        )}
      {summary && (
        <div className="mt-2 rounded-md border border-line bg-surface-1 px-3 py-2 text-sm text-ink-muted">
          <p>
            <span className="font-mono tabular-nums">{summary.new_games}</span>{' '}
            new games ·{' '}
            <span className="font-mono tabular-nums">{summary.deviations}</span>{' '}
            deviations
            {summary.resolved_earlier > 0 && (
              <>
                {' '}
                (
                <span className="font-mono tabular-nums">
                  {summary.resolved_earlier}
                </span>{' '}
                already drilled or dismissed earlier)
              </>
            )}{' '}
            · <span className="font-mono tabular-nums">{summary.in_book}</span>{' '}
            in book ·{' '}
            <span className="font-mono tabular-nums">{summary.uncovered}</span>{' '}
            not covered by your courses
            {summary.duplicates > 0 &&
              ` · ${summary.duplicates} already imported`}
            {summary.skipped_variants > 0 &&
              ` · ${summary.skipped_variants} variant games skipped`}
            {summary.skipped_unknown_player > 0 &&
              ` · ${summary.skipped_unknown_player} games without "${username.trim()}" skipped`}
          </p>
        </div>
      )}

      <div className="mt-6 flex gap-1 border-b border-line">
        <button
          type="button"
          onClick={() => setTab('deviations')}
          className={`px-3 py-1.5 text-sm transition-colors duration-150 ${
            tab === 'deviations'
              ? 'border-b-2 border-accent font-medium text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          Deviations
          {rows.length > 0 && (
            <span className="ml-1.5 font-mono text-xs tabular-nums">
              {rows.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('games')}
          className={`px-3 py-1.5 text-sm transition-colors duration-150 ${
            tab === 'games'
              ? 'border-b-2 border-accent font-medium text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          Games
          {games.length > 0 && (
            <span className="ml-1.5 font-mono text-xs tabular-nums">
              {games.length}
            </span>
          )}
        </button>
      </div>

      {loading ? null : tab === 'games' ? (
        games.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              icon={<Swords className="h-8 w-8" />}
              title="No games imported yet"
              hint="Sync Lichess or import a PGN — every game is kept here for you to browse."
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
            <div className="self-start">
              <div className="mb-2 flex items-center justify-between gap-2 px-1 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={
                      pagedGames.length > 0 &&
                      pagedGames.every((g) => checkedGameIds.has(g.id))
                    }
                    onChange={(e) => {
                      const check = e.target.checked
                      setCheckedGameIds((prev) => {
                        const next = new Set(prev)
                        for (const g of pagedGames) {
                          if (check) next.add(g.id)
                          else next.delete(g.id)
                        }
                        return next
                      })
                    }}
                    className="accent-accent"
                  />
                  Select page
                </label>
                {checkedGameIds.size > 0 && (
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-ink-muted">
                      {checkedGameIds.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingBulkDelete(true)}
                      className={buttonClasses({
                        variant: 'danger',
                        size: 'sm',
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete selected
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckedGameIds(new Set())}
                      className={buttonClasses({
                        variant: 'ghost',
                        size: 'sm',
                      })}
                    >
                      Clear
                    </button>
                  </span>
                )}
              </div>
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface-1">
                {pagedGames.map((game) => {
                  const entry = analyses.get(game.id)
                  const devCount = entry?.deviations.length ?? 0
                  const isSelected = game.id === selectedGameId
                  return (
                    <li key={game.id}>
                      {/* div-with-onClick, not <button>: the row hosts the
                          real delete button (no nested interactive content). */}
                      <div
                        onClick={() => setSelectedGameId(game.id)}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors duration-150 ${
                          isSelected ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checkedGameIds.has(game.id)}
                            onChange={() => toggleGameChecked(game.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Select game"
                            className="shrink-0 accent-accent"
                          />
                          <span className="min-w-0 truncate text-ink-muted">
                            <GameMetaLine game={game} />
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs">
                          {devCount > 0 ? (
                            <span className="font-medium text-danger">
                              {devCount} deviation{devCount === 1 ? '' : 's'}
                            </span>
                          ) : (entry?.matched ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-ink-muted">
                              <CircleCheck className="h-3.5 w-3.5 text-ok" /> in
                              book
                            </span>
                          ) : (
                            <span className="text-ink-faint">not covered</span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPendingDeleteGame(game)
                            }}
                            aria-label="Delete game"
                            title="Delete this game from the archive"
                            className="rounded p-1 text-ink-faint transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {gamesTotalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setGamesPage(currentGamesPage - 1)}
                    disabled={currentGamesPage === 0}
                    className={buttonClasses({
                      variant: 'secondary',
                      size: 'sm',
                    })}
                  >
                    ‹ Prev
                  </button>
                  <span className="font-mono text-xs tabular-nums text-ink-muted">
                    Page {currentGamesPage + 1} / {gamesTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setGamesPage(currentGamesPage + 1)}
                    disabled={currentGamesPage >= gamesTotalPages - 1}
                    className={buttonClasses({
                      variant: 'secondary',
                      size: 'sm',
                    })}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>

            <aside className="self-start lg:sticky lg:top-6">
              {selectedGame && (
                <GameAnalysisPanel
                  key={`game-${selectedGame.id}`}
                  game={selectedGame}
                  deviations={analyses.get(selectedGame.id)?.deviations ?? []}
                  anchorCursor={
                    (analyses.get(selectedGame.id)?.deviations[0]?.ply ?? 1) - 1
                  }
                />
              )}
            </aside>
          </div>
        )
      ) : rows.length === 0 &&
        (drilledByCourse.size > 0 || dismissedCount > 0) ? (
        <div className="mx-auto mt-10 max-w-lg rounded-xl border border-line bg-surface-1 p-6 text-center">
          <CircleCheck className="mx-auto h-10 w-10 text-ok" />
          <h2 className="mt-2 text-lg font-semibold text-ink">
            Review session complete
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {drilledTotal > 0 && `${drilledTotal} positions sent to drill`}
            {dismissedCount > 0 &&
              `${drilledTotal > 0 ? ' · ' : ''}${dismissedCount} dismissed`}
          </p>
          {drilledByCourse.size > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-ink-faint">
                Your drilled positions are waiting in the weak-point deck —
                practice them now:
              </p>
              {[...drilledByCourse.entries()].map(([pgnId, c]) => (
                <Link
                  key={pgnId}
                  to={`/pgn/${pgnId}/puzzles`}
                  className={buttonClasses({ variant: 'primary' })}
                >
                  Practice {c.count} position{c.count === 1 ? '' : 's'} in “
                  {c.name}” →
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<Target className="h-8 w-8" />}
            title={
              summary && summary.resolved_earlier > 0
                ? 'No pending deviations'
                : games.length > 0
                  ? 'No deviations found'
                  : 'Import your games to check them'
            }
            hint={
              summary && summary.resolved_earlier > 0
                ? 'Deviations you already drilled or dismissed stay resolved — they never reappear, even when you re-import the same games.'
                : games.length > 0
                  ? `Across ${games.length} stored games, every covered one followed your repertoire.`
                  : 'Export your games as PGN (Lichess or Chess.com) and import the file here.'
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <div className="self-start overflow-hidden rounded-xl border border-line bg-surface-1">
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const isSelected = row.key === selectedKey
                const expectedSans = row.deviation.expected
                  .map((m) => m.san)
                  .join(' / ')
                const course = row.deviation.expected[0].pgn_name
                return (
                  <li key={row.key}>
                    {/* Rows are informative only — Drill/Dismiss live in the
                        analysis panel and act on the selected row. */}
                    <button
                      type="button"
                      onClick={() => setSelectedKey(row.key)}
                      className={`w-full border-l-2 px-4 py-3 text-left transition-colors duration-150 ${
                        isSelected
                          ? 'border-accent bg-surface-2'
                          : 'border-transparent hover:bg-surface-2/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                        <span className="min-w-0 truncate">
                          <GameMetaLine game={row.game} />
                        </span>
                        <span className="shrink-0">
                          move {row.deviation.move_number}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-sm">
                        <span className="font-semibold text-danger">
                          {row.deviation.played_san}
                        </span>
                        <span className="mx-1.5 font-sans text-xs text-ink-faint">
                          instead of
                        </span>
                        <span className="font-semibold text-accent">
                          {expectedSans}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-faint">
                        {course}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-line px-4 py-2 text-xs text-ink-faint">
              {rows.length} pending · {games.length} game
              {games.length === 1 ? '' : 's'} analyzed
            </div>
          </div>

          <aside className="self-start lg:sticky lg:top-6">
            {selected && (
              <GameAnalysisPanel
                key={selected.key}
                game={selected.game}
                deviations={
                  analyses.get(selected.game.id)?.deviations ?? [
                    selected.deviation,
                  ]
                }
                anchorCursor={selected.deviation.ply - 1}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => void handleDrill(selected)}
                      title="Send this position to the weak-point deck"
                      className={buttonClasses({ variant: 'primary' })}
                    >
                      <Target className="h-4 w-4" /> Drill
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDismiss(selected)}
                      title="Hide this deviation permanently (it was deliberate, blitz, …)"
                      className={buttonClasses({ variant: 'ghost' })}
                    >
                      Dismiss
                    </button>
                  </>
                }
              />
            )}
          </aside>
        </div>
      )}
      {pendingBulkDelete && (
        <ConfirmDialog
          variant="danger"
          title={`Delete ${checkedGameIds.size} game${checkedGameIds.size === 1 ? '' : 's'}`}
          body="The selected games will be removed from the archive, along with their drill/dismiss history. If you re-import or re-sync them, their deviations come back as pending."
          confirmLabel={`Delete ${checkedGameIds.size} game${checkedGameIds.size === 1 ? '' : 's'}`}
          cancelLabel="Cancel"
          onConfirm={() => void confirmBulkDelete()}
          onCancel={() => setPendingBulkDelete(false)}
        />
      )}
      {pendingDeleteGame && (
        <ConfirmDialog
          variant="danger"
          title="Delete game"
          body={`${formatDate(pendingDeleteGame.played_at)} · ${pendingDeleteGame.white} — ${pendingDeleteGame.black} (${pendingDeleteGame.result}) will be removed from the archive, along with its drill/dismiss history. If you re-import or re-sync it, its deviations come back as pending.`}
          confirmLabel="Delete game"
          cancelLabel="Cancel"
          onConfirm={() => void confirmDeleteGame()}
          onCancel={() => setPendingDeleteGame(null)}
        />
      )}
    </main>
  )
}
