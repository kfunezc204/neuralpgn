import { Link } from 'react-router-dom'
import { Card } from './ui/Card.tsx'
import { buttonClasses } from './ui/Button.tsx'
import { KebabMenu } from './KebabMenu.tsx'
import { formatNextReview } from '../lib/NextReviewFormatter.ts'

interface CourseCardCounters {
  total: number
  learned: number
  mastered: number
  due: number
  nextDueAt: Date | null
  learnedThisWeek: number
}

interface CourseCardProps {
  pgn: {
    id: number
    name: string
    author: string | null
    is_challenge: boolean
  }
  counters: CourseCardCounters
  /** Active weak-point count; > 0 surfaces the 🎯 shortcut to puzzles. */
  weakPoints: number
  onRename: () => void
  onToggleChallenge: () => void
  onDelete: () => void
}

function CourseThumbnail() {
  return (
    <div
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-gradient-to-br from-surface-2 to-surface-3 text-3xl text-accent"
    >
      ♞
    </div>
  )
}

export function CourseCard({
  pgn,
  counters,
  weakPoints,
  onRename,
  onToggleChallenge,
  onDelete,
}: CourseCardProps) {
  const allLearned = counters.total > 0 && counters.learned >= counters.total
  const hasDue = counters.due > 0
  const learnDisabled = counters.total === 0 || allLearned
  const reviewDisabled = !hasDue

  const progressPct =
    counters.total === 0
      ? 0
      : Math.round((counters.learned / counters.total) * 100)

  return (
    <Card as="li" className="p-5 hover:border-line-strong hover:bg-surface-2">
      <div className="flex items-start gap-4">
        <Link
          to={`/pgn/${pgn.id}`}
          aria-label={`Open ${pgn.name}`}
          className="shrink-0 transition-transform duration-200 ease-out hover:scale-[1.04]"
        >
          <CourseThumbnail />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  to={`/pgn/${pgn.id}`}
                  className="min-w-0 truncate font-medium text-ink transition-colors duration-150 hover:text-accent"
                >
                  {pgn.name}
                </Link>
                {pgn.is_challenge && (
                  <span
                    className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs text-accent"
                    title="Challenge course: new positions are quizzed blind"
                  >
                    ⚡ Challenge
                  </span>
                )}
              </div>
              {pgn.author && (
                <p className="truncate text-xs text-ink-faint">
                  by {pgn.author}
                </p>
              )}
            </div>
            <KebabMenu
              ariaLabel={`Actions for ${pgn.name}`}
              items={[
                { label: 'Rename course', onClick: onRename },
                {
                  label: pgn.is_challenge
                    ? 'Disable challenge mode'
                    : 'Enable challenge mode',
                  onClick: onToggleChallenge,
                },
                { label: 'Delete course', onClick: onDelete, danger: true },
              ]}
            />
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="font-mono tabular-nums">
                {counters.learned} of {counters.total} lines learned
              </span>
              {counters.learnedThisWeek > 0 && (
                <span className="font-mono tabular-nums text-accent">
                  +{counters.learnedThisWeek} this week
                </span>
              )}
              {counters.mastered > 0 && (
                <span className="font-mono tabular-nums text-ok">
                  ✓ {counters.mastered} mastered
                </span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            {weakPoints > 0 && (
              <Link
                to={`/pgn/${pgn.id}/puzzles`}
                aria-label={`Train ${weakPoints} weak points of ${pgn.name}`}
                title="Puzzles from the positions you miss most — never writes to SRS"
                className="mr-auto text-xs text-ink-muted transition-colors duration-150 hover:text-accent"
              >
                🎯{' '}
                {weakPoints === 1
                  ? '1 weak point'
                  : `${weakPoints} weak points`}{' '}
                → train
              </Link>
            )}
            {reviewDisabled ? (
              counters.nextDueAt ? (
                <span
                  aria-label={`Next review ${formatNextReview(counters.nextDueAt, new Date())}`}
                  className="text-xs text-ink-faint"
                >
                  Up to date ✓ · next review{' '}
                  {formatNextReview(counters.nextDueAt, new Date())}
                </span>
              ) : (
                <span
                  aria-disabled="true"
                  aria-label="Review — no lines due"
                  title="No lines due"
                  className={buttonClasses({ disabled: true })}
                >
                  Review
                </span>
              )
            ) : (
              <Link
                to={`/pgn/${pgn.id}?tab=review`}
                aria-label={`Review ${pgn.name} (${counters.due} lines due)`}
                className={buttonClasses({ variant: 'primary' })}
              >
                Review
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-contrast/15 px-1.5 font-mono text-xs font-semibold tabular-nums">
                  {counters.due}
                </span>
              </Link>
            )}

            {learnDisabled ? (
              <span
                aria-disabled="true"
                aria-label={
                  allLearned ? 'Learn — completed' : 'Learn — no content'
                }
                title={allLearned ? 'Everything learned' : 'No content'}
                className={buttonClasses({ disabled: true })}
              >
                {allLearned ? '✓ Learn' : 'Learn'}
              </span>
            ) : (
              <Link
                to={`/pgn/${pgn.id}?tab=learn`}
                aria-label={`Learn ${pgn.name}`}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Learn
              </Link>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
