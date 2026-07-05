import { useEffect, useRef } from 'react'

/**
 * Clickable game notation. Each SAN is a button that moves the replay cursor
 * to the position AFTER that move; deviation moves are painted red. Used by
 * Game Check's analysis panel for both pending deviations and the archive.
 */
interface MoveNotationStripProps {
  sans: string[]
  /** Half-moves currently played on the board (0 = initial position). */
  cursor: number
  /** 1-based plies whose move left the repertoire — rendered in red. */
  deviationPlies: ReadonlySet<number>
  onSelect: (cursor: number) => void
}

export function MoveNotationStrip({
  sans,
  cursor,
  deviationPlies,
  onSelect,
}: MoveNotationStripProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Keep the current move visible while the user steps through the game —
  // without this, long games leave the strip scrolled to wherever it was.
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-ply="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  return (
    <div
      ref={containerRef}
      className="max-h-[38vh] overflow-y-auto rounded-md border border-line bg-surface-0/50 px-3 py-2 font-mono text-sm leading-6"
    >
      {sans.map((san, i) => {
        const ply = i + 1
        const isDeviation = deviationPlies.has(ply)
        const isCurrent = cursor === ply
        return (
          <span key={ply}>
            {i % 2 === 0 && (
              <span className="mr-1 select-none text-ink-faint">
                {i / 2 + 1}.
              </span>
            )}
            <button
              type="button"
              data-ply={ply}
              onClick={() => onSelect(ply)}
              className={[
                'rounded px-1 transition-colors duration-150',
                isCurrent ? 'bg-surface-3' : 'hover:bg-surface-2',
                isDeviation
                  ? 'font-semibold text-danger'
                  : isCurrent
                    ? 'text-ink'
                    : 'text-ink-muted',
              ].join(' ')}
            >
              {san}
            </button>{' '}
          </span>
        )
      })}
    </div>
  )
}
