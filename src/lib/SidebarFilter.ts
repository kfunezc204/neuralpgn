import { lineSidebarState } from './LineSidebarState.ts'
import { formatVariantLabel } from './VariantLabelFormatter.ts'
import type { LineStateLike } from './LineSidebarState.ts'

export interface FilterableLine {
  id: number
  dfs_index: number
  steps: Array<{ expected_san: string }>
}

export interface FilterableChapter {
  id: number
  name: string
  lines: FilterableLine[]
  lineStates: Map<number, LineStateLike>
}

export type StatusFilter = 'due' | 'new' | 'learning' | 'mastered'

export interface SidebarFilterCriteria {
  /** Free text matched against chapter names and variant labels. */
  query: string
  /** OR-combined; empty set = any status. AND-combined with the query. */
  statuses: ReadonlySet<StatusFilter>
}

export function isFiltering(criteria: SidebarFilterCriteria): boolean {
  return criteria.query.trim().length > 0 || criteria.statuses.size > 0
}

/**
 * Narrow the sidebar tree to matching lines. A chapter-name text match keeps
 * the whole chapter (status filters still apply per line); otherwise lines
 * match by their visible variant label. Chapters left empty are dropped.
 */
export function filterChapters<C extends FilterableChapter>(
  chapters: C[],
  criteria: SidebarFilterCriteria,
  now: Date,
): C[] {
  if (!isFiltering(criteria)) return chapters
  const query = normalize(criteria.query.trim())

  const out: C[] = []
  for (const chapter of chapters) {
    const chapterMatches =
      query.length === 0 || normalize(chapter.name).includes(query)

    const lines = chapter.lines.filter((line) => {
      const textOk =
        chapterMatches ||
        normalize(
          formatVariantLabel({
            line,
            chapter: { name: chapter.name, lineCount: chapter.lines.length },
          }),
        ).includes(query)
      if (!textOk) return false
      return statusMatches(chapter, line, criteria.statuses, now)
    })

    if (lines.length > 0) out.push({ ...chapter, lines })
  }
  return out
}

function statusMatches(
  chapter: FilterableChapter,
  line: FilterableLine,
  statuses: ReadonlySet<StatusFilter>,
  now: Date,
): boolean {
  if (statuses.size === 0) return true
  const view = lineSidebarState(chapter.lineStates.get(line.id) ?? null, now)
  if (statuses.has('due') && view.isDue) return true
  return statuses.has(view.status)
}

/** Lowercase + strip diacritics so "espanola" finds "Española". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
