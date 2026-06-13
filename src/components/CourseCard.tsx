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
          aria-label={`Abrir ${pgn.name}`}
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
                    title="Curso de reto: las posiciones nuevas se preguntan a ciegas"
                  >
                    ⚡ Reto
                  </span>
                )}
              </div>
              {pgn.author && (
                <p className="truncate text-xs text-ink-faint">
                  por {pgn.author}
                </p>
              )}
            </div>
            <KebabMenu
              ariaLabel={`Acciones de ${pgn.name}`}
              items={[
                { label: 'Renombrar curso', onClick: onRename },
                {
                  label: pgn.is_challenge
                    ? 'Desactivar modo reto'
                    : 'Activar modo reto',
                  onClick: onToggleChallenge,
                },
                { label: 'Borrar curso', onClick: onDelete, danger: true },
              ]}
            />
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="font-mono tabular-nums">
                {counters.learned} aprendidas de {counters.total} variantes
              </span>
              {counters.learnedThisWeek > 0 && (
                <span className="font-mono tabular-nums text-accent">
                  +{counters.learnedThisWeek} esta semana
                </span>
              )}
              {counters.mastered > 0 && (
                <span className="font-mono tabular-nums text-ok">
                  ✓ {counters.mastered} dominadas
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
                aria-label={`Entrenar ${weakPoints} puntos débiles de ${pgn.name}`}
                title="Puzzles de las posiciones donde más fallas — no escribe en SRS"
                className="mr-auto text-xs text-ink-muted transition-colors duration-150 hover:text-accent"
              >
                🎯{' '}
                {weakPoints === 1
                  ? '1 punto débil'
                  : `${weakPoints} puntos débiles`}{' '}
                → entrenar
              </Link>
            )}
            {reviewDisabled ? (
              counters.nextDueAt ? (
                <span
                  aria-label={`Próximo repaso ${formatNextReview(counters.nextDueAt, new Date())}`}
                  className="text-xs text-ink-faint"
                >
                  Al día ✓ · próximo repaso{' '}
                  {formatNextReview(counters.nextDueAt, new Date())}
                </span>
              ) : (
                <span
                  aria-disabled="true"
                  aria-label="Repasar — sin variantes pendientes"
                  title="No hay variantes due"
                  className={buttonClasses({ disabled: true })}
                >
                  Repasar
                </span>
              )
            ) : (
              <Link
                to={`/pgn/${pgn.id}?tab=review`}
                aria-label={`Repasar ${pgn.name} (${counters.due} variantes due)`}
                className={buttonClasses({ variant: 'primary' })}
              >
                Repasar
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-contrast/15 px-1.5 font-mono text-xs font-semibold tabular-nums">
                  {counters.due}
                </span>
              </Link>
            )}

            {learnDisabled ? (
              <span
                aria-disabled="true"
                aria-label={
                  allLearned
                    ? 'Aprender — completado'
                    : 'Aprender — sin contenido'
                }
                title={allLearned ? 'Todo aprendido' : 'Sin contenido'}
                className={buttonClasses({ disabled: true })}
              >
                {allLearned ? '✓ Aprender' : 'Aprender'}
              </span>
            ) : (
              <Link
                to={`/pgn/${pgn.id}?tab=learn`}
                aria-label={`Aprender ${pgn.name}`}
                className={buttonClasses({ variant: 'secondary' })}
              >
                Aprender
              </Link>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
