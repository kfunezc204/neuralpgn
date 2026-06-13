import type { Repository } from './Repository.ts'
import type { ProfileSummarySnapshot } from './ProfileStore.ts'

/**
 * Take the stats snapshot the profile selector shows (courses, dues, last
 * use). Runs against the OPEN profile's repo — the selector itself never
 * opens databases, it reads whatever snapshot the last session left behind.
 */
export async function computeProfileSummary(
  repo: Repository,
  now: Date = new Date(),
): Promise<ProfileSummarySnapshot> {
  const [pgns, dueLines] = await Promise.all([
    repo.listPgns(),
    repo.getDueLinesAllChapters(now),
  ])
  return {
    course_count: pgns.length,
    due_count: dueLines.length,
    last_used_at: now.toISOString(),
  }
}

export function formatProfileSummary(
  summary: ProfileSummarySnapshot | undefined,
  now: Date,
): string {
  if (!summary) return 'Perfil nuevo'
  const courses =
    summary.course_count === 1 ? '1 curso' : `${summary.course_count} cursos`
  const dues =
    summary.due_count === 0
      ? 'al día'
      : summary.due_count === 1
        ? '1 repaso pendiente'
        : `${summary.due_count} repasos pendientes`
  return `${courses} · ${dues} · usado ${formatLastUsed(new Date(summary.last_used_at), now)}`
}

function formatLastUsed(lastUsed: Date, now: Date): string {
  const dayMs = 24 * 60 * 60 * 1000
  const a = new Date(lastUsed.getFullYear(), lastUsed.getMonth(), lastUsed.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((b.getTime() - a.getTime()) / dayMs)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}
