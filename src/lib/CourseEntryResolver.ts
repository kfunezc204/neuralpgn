import type { CourseTab } from './TabModeResolver.ts'

export interface LineIdRef {
  line_id: number
}

export interface CourseEntryInput {
  tab: CourseTab | null
  nextLearn: LineIdRef | null
  nextDue: LineIdRef | null
  firstLine: LineIdRef | null
}

export interface CourseEntryRedirect {
  lineId: number
  query: string
}

export function resolveCourseEntry(
  input: CourseEntryInput,
): CourseEntryRedirect | null {
  if (input.tab === 'learn' && input.nextLearn)
    return { lineId: input.nextLearn.line_id, query: '?tab=learn' }
  if (input.tab === 'review' && input.nextDue)
    return { lineId: input.nextDue.line_id, query: '?tab=review' }

  // Smart fallback: prefer next new line, then next due, then first line in refresher.
  if (input.nextLearn)
    return { lineId: input.nextLearn.line_id, query: '?tab=learn' }
  if (input.nextDue)
    return { lineId: input.nextDue.line_id, query: '?tab=review' }
  if (input.firstLine)
    return { lineId: input.firstLine.line_id, query: '?mode=refresh' }
  return null
}
