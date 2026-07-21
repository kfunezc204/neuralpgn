import { Chess } from 'chess.js'
import { parseGames } from '@mliebelt/pgn-parser'
import type {
  BoardShape,
  Card,
  Chapter,
  IngestOptions,
  IngestResult,
  IngestWarning,
  Line,
  LineStep,
  Refutation,
  ShapeBrush,
  UserSide,
} from './types.ts'

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const BAD_NAGS = new Set(['$2', '$4', '$6'])

function hasBadNag(nags: string[] | undefined): boolean {
  if (!nags) return false
  for (const n of nags) if (BAD_NAGS.has(n)) return true
  return false
}

interface MinimalMove {
  notation: { notation: string }
  nag?: string[]
  variations?: MinimalMove[][]
  turn?: 'w' | 'b'
  commentMove?: string
  commentAfter?: string
  // The parser splits [%cal]/[%csl] out of the comment text into these.
  // colorArrows/colorFields hold parsed entries when every color letter is
  // one the parser knows; otherwise the whole tag lands raw under cal/csl.
  commentDiag?: {
    colorArrows?: string[]
    colorFields?: string[]
    cal?: string
    csl?: string
  }
}

// Lichess color letters → chessground brushes; unknown letters fall back to
// green so a malformed annotation degrades to a visible-but-neutral shape.
const BRUSH_BY_LETTER: Record<string, ShapeBrush> = {
  G: 'green',
  R: 'red',
  B: 'blue',
  Y: 'yellow',
}

function brushFor(letter: string): ShapeBrush {
  return BRUSH_BY_LETTER[letter] ?? 'green'
}

/** "Ge2e4" → arrow, "Gc6" → square highlight. Malformed entries are skipped. */
function shapesFromDiag(diag: MinimalMove['commentDiag']): BoardShape[] {
  const arrows = diag?.colorArrows ?? diag?.cal?.split(',') ?? []
  const fields = diag?.colorFields ?? diag?.csl?.split(',') ?? []
  const shapes: BoardShape[] = []
  for (const a of arrows) {
    const m = /^(\w)([a-h][1-8])([a-h][1-8])$/.exec(a.trim())
    if (m) shapes.push({ brush: brushFor(m[1]), orig: m[2], dest: m[3] })
  }
  for (const f of fields) {
    const m = /^(\w)([a-h][1-8])$/.exec(f.trim())
    if (m) shapes.push({ brush: brushFor(m[1]), orig: m[2] })
  }
  return shapes
}

function canonicalFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

function sideToMoveFromFen(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] as 'w' | 'b'
}

function isUserTurn(turn: 'w' | 'b', userSide: UserSide): boolean {
  if (userSide === 'stm') return true
  if (turn === 'w' && userSide === 'white') return true
  if (turn === 'b' && userSide === 'black') return true
  return false
}

type GameWithTags = { tags?: { FEN?: string } }

interface DetectedSide {
  side: UserSide
  warning?: IngestWarning
}

function detectUserSide(
  name: string,
  games: GameWithTags[],
  resolver: IngestOptions['resolveStartingSide'],
): DetectedSide {
  const stms = new Set<'w' | 'b'>()
  for (const g of games) {
    const fen = g.tags?.FEN
    if (fen) stms.add(sideToMoveFromFen(fen))
  }
  if (stms.size === 1) return { side: stms.has('w') ? 'white' : 'black' }
  if (stms.size > 1) return { side: 'stm' }

  if (resolver) {
    return { side: resolver({ name, starts_from_initial_position: true }) }
  }
  return {
    side: 'white',
    warning: {
      code: 'side_unresolved',
      message: `Chapter "${name}" starts from the initial position and no resolveStartingSide callback was provided; defaulting to white.`,
      chapter_name: name,
    },
  }
}

interface ChapterAccumulator {
  id: string
  name: string
  userSide: UserSide
  cards: Card[]
  cardsByFen: Map<string, Card>
  cardIds: string[]
  lines: Line[]
  lineIds: string[]
  intro_comment?: string
}

interface IngestCounters {
  cardIdx: number
  lineIdx: number
}

function getOrCreateCard(
  acc: ChapterAccumulator,
  counters: IngestCounters,
  preFen: string,
): Card {
  const fenCanon = canonicalFen(preFen)
  const existing = acc.cardsByFen.get(fenCanon)
  if (existing) return existing

  const card: Card = {
    id: `card_${counters.cardIdx++}`,
    chapter_id: acc.id,
    fen_canonical: fenCanon,
    refutations: [],
  }
  acc.cards.push(card)
  acc.cardsByFen.set(fenCanon, card)
  acc.cardIds.push(card.id)
  return card
}

function emitLine(
  acc: ChapterAccumulator,
  counters: IngestCounters,
  steps: LineStep[],
  introComment?: string,
): void {
  // A branch with no user moves (opponent-only variation, Z0 truncated at the
  // root, …) is untrainable: a zero-step line would complete instantly and
  // self-grade Good, and it inflates chapter counters.
  if (steps.length === 0) return
  const line: Line = {
    id: `line_${counters.lineIdx++}`,
    chapter_id: acc.id,
    dfs_index: acc.lineIds.length,
    steps: [...steps],
    ...(introComment ? { intro_comment: introComment } : {}),
  }
  acc.lines.push(line)
  acc.lineIds.push(line.id)
}

interface PendingVariation {
  moves: MinimalMove[]
  fen: string
  prefix: LineStep[]
  // Shapes describing the branch position (from the move that led to it), so
  // the variation's first user card gets them even if the mainline didn't.
  startShapes: BoardShape[]
}

function runPendingVariations(
  pending: PendingVariation[],
  acc: ChapterAccumulator,
  counters: IngestCounters,
  warnings: IngestWarning[],
  introComment?: string,
): void {
  for (const v of pending) {
    walkLine(
      v.moves,
      v.fen,
      v.prefix,
      acc,
      counters,
      warnings,
      introComment,
      v.startShapes,
    )
  }
}

function walkLine(
  moves: MinimalMove[],
  startFen: string,
  prefixSteps: LineStep[],
  acc: ChapterAccumulator,
  counters: IngestCounters,
  warnings: IngestWarning[],
  // Game-level comment (before move 1); every line emitted from this game's
  // tree carries it so the exercise/lesson context survives per line (US35).
  introComment?: string,
  // Shapes describing startFen (from the game comment, or from the move that
  // led to a variation's branch point).
  startShapes: BoardShape[] = [],
): void {
  const chess = new Chess(startFen)
  const steps: LineStep[] = [...prefixSteps]
  const pending: PendingVariation[] = []
  // Lichess semantics: a %cal/%csl tag on a move describes the position AFTER
  // that move. pendingShapes always holds the shapes for the CURRENT position,
  // harvested from the previous move (or from startShapes at the top).
  let pendingShapes: BoardShape[] = startShapes

  for (const rawMove of moves) {
    let move: MinimalMove = rawMove
    if (rawMove.notation.notation === 'Z0') {
      const firstVar = (rawMove.variations ?? []).find((v) => v.length > 0)
      if (!firstVar) {
        warnings.push({
          code: 'z0_no_variation',
          message: 'Z0 has no listed variation; truncating branch.',
          chapter_name: acc.name,
        })
        emitLine(acc, counters, steps, introComment)
        runPendingVariations(pending, acc, counters, warnings, introComment)
        return
      }
      const replacement = firstVar[0]
      move = { ...replacement, turn: rawMove.turn, variations: [] }
    }

    const san = move.notation.notation
    const turn =
      (move.turn as 'w' | 'b' | undefined) ?? (chess.turn() as 'w' | 'b')
    const preFen = chess.fen()

    for (const variation of move.variations ?? []) {
      if (variation.length === 0) continue
      const firstVar = variation[0]
      const varTurn =
        (firstVar.turn as 'w' | 'b' | undefined) ?? (chess.turn() as 'w' | 'b')
      if (hasBadNag(firstVar.nag) && isUserTurn(varTurn, acc.userSide)) {
        const card = getOrCreateCard(acc, counters, preFen)
        const continuation = variation.slice(1).map((m) => m.notation.notation)
        const refComment = firstVar.commentAfter ?? firstVar.commentMove
        const refutation: Refutation = {
          san: firstVar.notation.notation,
          continuation,
          ...(refComment ? { comment: refComment } : {}),
        }
        card.refutations.push(refutation)
        continue
      }
      pending.push({
        moves: variation,
        fen: preFen,
        prefix: [...steps],
        startShapes: pendingShapes,
      })
    }

    // Validate the move BEFORE materializing its step: a truncated line must
    // not end on an unplayable expected_san (the trainee could never answer it).
    try {
      chess.move(san)
    } catch {
      warnings.push({
        code: 'pgn_parse_error',
        message: `Illegal move ${san}`,
        chapter_name: acc.name,
      })
      emitLine(acc, counters, steps, introComment)
      runPendingVariations(pending, acc, counters, warnings, introComment)
      return
    }

    // This move's own shapes describe the position AFTER it (Lichess draws
    // them on the board the author was looking at, i.e. post-move).
    const moveShapes = shapesFromDiag(move.commentDiag)

    if (isUserTurn(turn, acc.userSide)) {
      const card = getOrCreateCard(acc, counters, preFen)
      const moveComment = move.commentAfter ?? move.commentMove
      if (moveComment && !card.comment) card.comment = moveComment
      // Shapes for THIS position came from the previous move (usually the
      // opponent's). First appearance wins on FEN-deduped cards.
      if (pendingShapes.length > 0 && !card.shapes) card.shapes = pendingShapes
      steps.push({
        card_id: card.id,
        expected_san: san,
        // Shapes on the user's own move belong to the post-move frame.
        ...(moveShapes.length > 0 ? { shapes_after: moveShapes } : {}),
      })
    }

    pendingShapes = moveShapes
  }

  emitLine(acc, counters, steps, introComment)
  runPendingVariations(pending, acc, counters, warnings, introComment)
}

export class PgnIngestor {
  ingest(pgnText: string, opts: IngestOptions = {}): IngestResult {
    const chapters: Chapter[] = []
    const allCards: Card[] = []
    const allLines: Line[] = []
    const warnings: IngestWarning[] = []

    let games: ReturnType<typeof parseGames>
    try {
      games = parseGames(pgnText)
    } catch (err) {
      warnings.push({
        code: 'pgn_parse_error',
        message:
          err instanceof Error
            ? err.message
            : `PGN parse failed: ${String(err)}`,
      })
      return { chapters: [], cards: [], lines: [], warnings }
    }

    let author: string | undefined
    for (const g of games) {
      const annotator = (g.tags as { Annotator?: string } | undefined)
        ?.Annotator
      if (annotator) {
        author = annotator
        break
      }
    }

    // Chapter grouping key: Lichess study exports name each game via
    // ChapterName (and leave White unset); Chessable-style files use White
    // as the section name. ChapterName wins when both exist.
    const groups = new Map<string, typeof games>()
    for (const g of games) {
      const tags = g.tags as
        | { White?: string; ChapterName?: string }
        | undefined
      const name = tags?.ChapterName ?? tags?.White ?? '(unnamed)'
      const arr = groups.get(name) ?? []
      arr.push(g)
      groups.set(name, arr)
    }

    const counters: IngestCounters = { cardIdx: 0, lineIdx: 0 }
    let chapterIdx = 0

    for (const [name, gameGroup] of groups) {
      const chapterId = `chapter_${chapterIdx++}`
      const detected = detectUserSide(name, gameGroup, opts.resolveStartingSide)
      if (detected.warning) warnings.push(detected.warning)

      const acc: ChapterAccumulator = {
        id: chapterId,
        name,
        userSide: detected.side,
        cards: [],
        cardsByFen: new Map(),
        cardIds: [],
        lines: [],
        lineIds: [],
      }

      for (const game of gameGroup) {
        const tags = game.tags as { FEN?: string } | undefined
        const startFen = tags?.FEN ?? INITIAL_FEN
        const intro = game.gameComment?.comment ?? undefined
        if (intro && !acc.intro_comment) acc.intro_comment = intro
        // %cal/%csl in the game comment describe the starting position.
        const startShapes = shapesFromDiag(
          game.gameComment as MinimalMove['commentDiag'],
        )
        walkLine(
          game.moves as MinimalMove[],
          startFen,
          [],
          acc,
          counters,
          warnings,
          intro,
          startShapes,
        )
      }

      allCards.push(...acc.cards)
      allLines.push(...acc.lines)

      chapters.push({
        id: chapterId,
        name,
        user_side: detected.side,
        card_ids: acc.cardIds,
        line_ids: acc.lineIds,
        ...(acc.intro_comment ? { intro_comment: acc.intro_comment } : {}),
      })
    }

    return {
      chapters,
      cards: allCards,
      lines: allLines,
      warnings,
      ...(author ? { author } : {}),
    }
  }
}
