import { Fragment, type ReactNode } from 'react'
import { quizSideAnnouncement } from '../lib/QuizSideAnnouncer.ts'
import { formatVariantLabel } from '../lib/VariantLabelFormatter.ts'
import {
  formatHistoryAsPgnFlow,
  type MoveFlowToken,
  type SanStyle,
} from '../lib/MoveNotationFormatter.ts'
import type { WalkHistoryEntry } from '../lib/WalkHistory.ts'
import type { WalkMode } from '../lib/TabModeResolver.ts'
import type { ChapterRow, PersistedLine } from '../lib/Repository.ts'

interface CommentsPanelProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  chapter: ChapterRow | null
  line: PersistedLine | null
  chapterLineCount: number
  mode: WalkMode | null
  initialFen: string | null
  history: WalkHistoryEntry[]
  currentReplayIndex?: number | null
  onJumpToReplay?: (stepIndex: number) => void
}

function CommentBlock({ text }: { text: string }) {
  const marker = '[#]'
  if (text.includes(marker)) {
    const stripped = text.replaceAll(marker, '').trim()
    return (
      <div className="rounded-md border-l-4 border-accent bg-accent-soft p-3 text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
          Pregunta
        </div>
        <div className="text-ink">{stripped}</div>
      </div>
    )
  }
  return <p className="text-sm text-ink-muted">{text}</p>
}

function sanColorClass(style: SanStyle, isCurrentReplay: boolean): string {
  if (isCurrentReplay) return 'bg-accent-soft text-accent font-medium'
  switch (style) {
    case 'correct':
      return 'text-ok'
    case 'wrong':
      return 'text-danger line-through'
    case 'auto':
      return 'text-ink-muted'
    case 'replay':
      return 'text-ink'
  }
}

function HistoryFlow({
  tokens,
  onJump,
}: {
  tokens: MoveFlowToken[]
  onJump?: (stepIndex: number) => void
}) {
  // Tokens are interleaved with real text-node spaces — adjacent inline
  // elements with only margins between them have no soft-wrap points, so a
  // long line would overflow the panel horizontally instead of wrapping.
  return (
    <div className="text-sm leading-7 text-ink-muted">
      {tokens.map((token, i) => {
        let rendered: ReactNode = null
        switch (token.kind) {
          case 'move-number':
            rendered = (
              <span className="font-mono font-semibold text-ink-faint">
                {token.text}
              </span>
            )
            break
          case 'san': {
            const colorClass = sanColorClass(token.style, token.isCurrentReplay)
            rendered =
              token.style === 'replay' && onJump ? (
                <button
                  type="button"
                  onClick={() => onJump(token.index)}
                  className={`rounded px-0.5 font-mono transition-colors duration-150 hover:bg-surface-3 ${colorClass}`}
                >
                  {token.text}
                </button>
              ) : (
                <span className={`font-mono ${colorClass}`}>{token.text}</span>
              )
            break
          }
          case 'refutation-parens':
            rendered = (
              <span className="font-mono text-danger">
                ({token.moves.join(' ')})
              </span>
            )
            break
          case 'comment':
            rendered = (
              <span className="italic text-ink-muted">{`{${token.text}}`}</span>
            )
            break
        }
        return <Fragment key={i}>{rendered} </Fragment>
      })}
    </div>
  )
}

export function CommentsPanel({
  collapsed,
  onToggleCollapsed,
  chapter,
  line,
  chapterLineCount,
  mode,
  initialFen,
  history,
  currentReplayIndex,
  onJumpToReplay,
}: CommentsPanelProps) {
  if (collapsed) {
    return (
      <aside className="hidden w-10 shrink-0 border-l border-line bg-surface-1 lg:flex lg:flex-col lg:items-center lg:py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand panel"
          aria-expanded={false}
          aria-controls="comments-panel-body"
          className="rounded p-1 text-ink-muted transition-colors duration-150 hover:bg-surface-3"
        >
          ☰
        </button>
      </aside>
    )
  }

  const variantLabel =
    chapter && line
      ? formatVariantLabel({
          line,
          chapter: { name: chapter.name, lineCount: chapterLineCount },
        })
      : (chapter?.name ?? '')

  // Per-line intro (the game comment of the exercise/lesson) wins over the
  // chapter-level intro, which only carries the first game's comment.
  const introComment = line?.intro_comment ?? chapter?.intro_comment ?? null

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-line bg-surface-1 lg:flex">
      <div
        id="comments-panel-body"
        className="flex-1 overflow-x-hidden overflow-y-auto break-words"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface-2/95 px-4 py-3 backdrop-blur-sm">
          <h2
            className="min-w-0 truncate text-sm font-semibold text-ink"
            title={variantLabel}
          >
            {variantLabel}
          </h2>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse panel"
            aria-expanded={true}
            aria-controls="comments-panel-body"
            className="ml-2 rounded p-1 text-ink-muted transition-colors duration-150 hover:bg-surface-3"
          >
            ☰
          </button>
        </header>

        <div className="px-4 py-3">
          {introComment && (
            <section className="mb-4">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                About this line
              </h3>
              <CommentBlock text={introComment} />
            </section>
          )}

          {mode === 'quiz' && initialFen && (
            <section className="mb-4 rounded-md border border-accent/30 bg-accent-soft p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                Quiz
              </div>
              <p className="mt-1 text-sm font-medium text-ink">
                {quizSideAnnouncement(initialFen)}
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              History
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-ink-faint">No moves recorded yet.</p>
            ) : (
              <HistoryFlow
                tokens={formatHistoryAsPgnFlow({
                  history,
                  initialFen,
                  currentReplayIndex:
                    mode === 'replay' ? currentReplayIndex : null,
                })}
                onJump={mode === 'replay' ? onJumpToReplay : undefined}
              />
            )}
          </section>
        </div>
      </div>
    </aside>
  )
}
