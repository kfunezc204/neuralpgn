import { MasteryEvaluator } from './MasteryEvaluator.ts'

export type SidebarStatus = 'new' | 'learning' | 'mastered'

export interface LineStateLike {
  state: 'new' | 'learning' | 'review' | 'relearning'
  stability: number
  consecutive_correct: number
  due: Date
}

export interface SidebarStateView {
  status: SidebarStatus
  isDue: boolean
}

const evaluator = new MasteryEvaluator()

export function lineSidebarState(
  lineState: LineStateLike | null,
  now: Date,
): SidebarStateView {
  if (lineState === null || lineState.state === 'new') {
    return { status: 'new', isDue: false }
  }
  const mastered = evaluator.isMastered({
    stability: lineState.stability,
    consecutive_correct: lineState.consecutive_correct,
  })
  const isDue = lineState.due.getTime() <= now.getTime()
  return { status: mastered ? 'mastered' : 'learning', isDue }
}
