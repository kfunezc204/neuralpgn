import type { LineSrsStateName } from './types.ts'

export interface SelectableLesson {
  id: number
  dfs_index: number
  card_ids: number[]
}

export interface ChapterCardRef {
  card_id: number
  chapter_id: number
}

export interface ChapterLineRef {
  line_id: number
  chapter_id: number
}

export interface LearnCandidate {
  dfs_index: number
  state: LineSrsStateName
}

export class SessionSelector {
  pickNextLessonToLearn<L extends LearnCandidate>(
    lines: ReadonlyArray<L>,
  ): L | null {
    let best: L | null = null
    for (const l of lines) {
      if (l.state !== 'new') continue
      if (best === null || l.dfs_index < best.dfs_index) best = l
    }
    return best
  }

  pickLineForChapter<L extends SelectableLesson>(
    lessons: readonly L[],
    dueCardIds: ReadonlySet<number>,
  ): L | null {
    let best: { lesson: L; due: number } | null = null
    for (const l of lessons) {
      let count = 0
      for (const id of l.card_ids) if (dueCardIds.has(id)) count++
      if (count === 0) continue
      if (
        best === null ||
        count > best.due ||
        (count === best.due && l.dfs_index < best.lesson.dfs_index)
      ) {
        best = { lesson: l, due: count }
      }
    }
    return best?.lesson ?? null
  }

  /**
   * Interleaves due cards from multiple chapters in stable round-robin order,
   * so consecutive cards come from different chapters whenever possible.
   * Within a chapter the original input order is preserved.
   */
  pickInterleavedGlobal<R extends ChapterCardRef>(refs: readonly R[]): R[] {
    return interleaveByChapter(refs)
  }

  /**
   * Line-aware variant of pickInterleavedGlobal — same round-robin rule applied
   * to {line_id, chapter_id} refs (the line-as-atom equivalent for cross-chapter
   * Repasar sessions).
   */
  pickInterleavedGlobalLines<R extends ChapterLineRef>(
    refs: readonly R[],
  ): R[] {
    return interleaveByChapter(refs)
  }
}

function interleaveByChapter<R extends { chapter_id: number }>(
  refs: readonly R[],
): R[] {
  if (refs.length === 0) return []
  const buckets = new Map<number, R[]>()
  const chapterOrder: number[] = []
  for (const r of refs) {
    let bucket = buckets.get(r.chapter_id)
    if (!bucket) {
      bucket = []
      buckets.set(r.chapter_id, bucket)
      chapterOrder.push(r.chapter_id)
    }
    bucket.push(r)
  }
  const out: R[] = []
  while (out.length < refs.length) {
    for (const chapterId of chapterOrder) {
      const bucket = buckets.get(chapterId)
      if (bucket && bucket.length > 0) out.push(bucket.shift()!)
    }
  }
  return out
}
