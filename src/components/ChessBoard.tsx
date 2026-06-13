import { useCallback, useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api as ChessgroundApi } from 'chessground/api'
import type { Key } from 'chessground/types'
import { legalDests, resolveMove } from '../lib/MoveResolver.ts'
import type { BoardShape } from '../lib/types.ts'

interface ChessBoardProps {
  fen: string
  orientation?: 'white' | 'black'
  // Fixed pixel size. When omitted, the board fills its parent container —
  // the parent is responsible for giving cg-wrap square dimensions
  // (e.g., width + aspect-ratio: 1/1).
  size?: number
  // When provided, the user can drag pieces. The callback fires after a legal
  // chessground drag-drop is resolved against chess.js. When undefined,
  // dragging is gated via the events.after callback (chessground still
  // accepts drags visually, but no move is reported to the parent).
  onMove?: (move: { san: string; uci: string; fen_after: string }) => void
  // Green arrow shown on the board (e.g. teach mode's expected move).
  highlight?: { from: string; to: string }
  // Yellow last-move highlight (chessground native).
  lastMove?: { from: string; to: string }
  // Author-drawn annotations (%cal/%csl). Drawn under the highlight so
  // feedback stays readable on top.
  shapes?: BoardShape[]
  // Bump to force re-applying the current fen (e.g. snap a piece back after a
  // wrong quiz attempt) without remounting Chessground.
  revertToken?: number
}

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

function destsForFen(fen: string): Map<Key, Key[]> {
  const out = new Map<Key, Key[]>()
  for (const [from, tos] of legalDests(fen)) {
    out.set(from as Key, tos as Key[])
  }
  return out
}

function shapesFor(
  highlight?: { from: string; to: string },
  authorShapes?: BoardShape[],
) {
  // Author annotations first, feedback highlight last: chessground draws in
  // order, so the highlight lands on top and stays readable.
  const out = (authorShapes ?? []).map((s) => ({
    orig: s.orig as Key,
    ...(s.dest ? { dest: s.dest as Key } : {}),
    brush: s.brush,
  }))
  if (highlight) {
    out.push({
      orig: highlight.from as Key,
      dest: highlight.to as Key,
      brush: 'green' as const,
    })
  }
  return out
}

function lastMoveTuple(
  m: { from: string; to: string } | undefined,
): Key[] | undefined {
  if (!m) return undefined
  return [m.from as Key, m.to as Key]
}

export function ChessBoard({
  fen,
  orientation = 'white',
  size,
  onMove,
  highlight,
  lastMove,
  shapes,
  revertToken,
}: ChessBoardProps) {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<ChessgroundApi | null>(null)
  const fenRef = useRef(fen)
  const onMoveRef = useRef(onMove)
  const shapesRef = useRef(shapes)
  fenRef.current = fen
  onMoveRef.current = onMove
  shapesRef.current = shapes
  // Stable primitive for the reactive effect: parents pass fresh array
  // literals on every render, same as the {from,to} props below.
  const shapesKey = shapes && shapes.length > 0 ? JSON.stringify(shapes) : ''

  // The `events.after` handler closes over refs so its behavior tracks the
  // latest props without needing chessground to re-bind listeners.
  const afterMoveHandler = useCallback((orig: Key, dest: Key) => {
    const cb = onMoveRef.current
    if (!cb) return
    const resolved = resolveMove(fenRef.current, orig as string, dest as string)
    if (resolved) cb(resolved)
  }, [])

  // Field-level locals so the reactive effect can depend on primitives —
  // parents pass fresh {from,to} object literals on every render.
  const highlightFrom = highlight?.from
  const highlightTo = highlight?.to
  const lastMoveFrom = lastMove?.from
  const lastMoveTo = lastMove?.to

  // Init once. Drag listeners bind here and stay alive for the whole walk.
  // Dests and color are ALWAYS valid (legal moves for side-to-move) so the
  // chessground drag state stays healthy across step transitions; the
  // events.after callback gates whether a played move is honored.
  useEffect(() => {
    if (!elementRef.current) return
    const api = Chessground(elementRef.current, {
      fen,
      orientation,
      coordinates: true,
      viewOnly: false,
      animation: { enabled: true, duration: 250 },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: false },
      premovable: { enabled: false },
      predroppable: { enabled: false },
      movable: {
        free: false,
        color: sideToMove(fen),
        dests: destsForFen(fen),
        showDests: !!onMoveRef.current,
        events: { after: afterMoveHandler },
      },
      drawable: { autoShapes: shapesFor(highlight, shapes) },
      lastMove: lastMoveTuple(lastMove),
    })
    apiRef.current = api
    return () => {
      api.destroy()
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Heavy reactive update — fires only on real position/orientation changes.
  // Includes `api.set({fen})`, which resets pieces from the fen string, so
  // we MUST NOT fire on every parent render (that snaps a just-dragged piece
  // back to its origin while step.fen still references the pre-move position).
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.cancelMove()
    api.set({
      fen,
      orientation,
      turnColor: sideToMove(fen),
      movable: {
        free: false,
        color: sideToMove(fen),
        dests: destsForFen(fen),
        showDests: !!onMoveRef.current,
        events: { after: afterMoveHandler },
      },
      drawable: {
        autoShapes: shapesFor(
          highlightFrom && highlightTo
            ? { from: highlightFrom, to: highlightTo }
            : undefined,
          shapesRef.current,
        ),
      },
      lastMove: lastMoveTuple(
        lastMoveFrom && lastMoveTo
          ? { from: lastMoveFrom, to: lastMoveTo }
          : undefined,
      ),
    })
  }, [
    fen,
    orientation,
    highlightFrom,
    highlightTo,
    lastMoveFrom,
    lastMoveTo,
    shapesKey,
    revertToken,
    afterMoveHandler,
  ])

  // Chessground caches the board's bounding rect via getBoundingClientRect
  // and only invalidates it on ResizeObserver (size-only) or scroll. Layout
  // shifts that move the board WITHOUT resizing it — e.g., intro_comment
  // collapsing on first interaction, feedback text appearing under the board,
  // hint comment toggling — leave bounds stale, so getKeyAtDomPos maps clicks
  // to the wrong square (the user has to click below the visual center to
  // hit the actual square). Clear the cache after every commit; the next
  // click reads a fresh getBoundingClientRect.
  useEffect(() => {
    apiRef.current?.state.dom.bounds.clear()
  })

  return (
    <div
      ref={elementRef}
      className="cg-wrap"
      style={
        size !== undefined
          ? { width: `${size}px`, height: `${size}px` }
          : { width: '100%', height: '100%' }
      }
    />
  )
}
