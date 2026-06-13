export type CourseTab = 'learn' | 'review'

export type WalkMode = 'teach' | 'quiz' | 'refresher' | 'replay'

export type ModeOverride = 'refresh' | 'archive' | null

export interface ResolverLineState {
  state: 'new' | 'learning' | 'review' | 'relearning'
  stability: number
  consecutive_correct: number
  due: Date
}

export interface ResolveTabModeInput {
  tab: CourseTab | null
  lineState: ResolverLineState | null
  modeOverride: ModeOverride
  now: Date
  isArchived?: boolean
  /** Challenge course: new lines are quizzed blind instead of taught. */
  isChallenge?: boolean
}

export type TabModeResult =
  | { kind: 'allowed'; mode: WalkMode }
  | { kind: 'disabled'; reason: 'not-due' }

export function resolveTabMode(input: ResolveTabModeInput): TabModeResult {
  // Archived lines always replay, regardless of tab/override.
  if (input.isArchived === true) {
    return { kind: 'allowed', mode: 'replay' }
  }

  // mode=archive on a non-archived line is ignored — fall through to tab logic.

  if (input.modeOverride === 'refresh') {
    return { kind: 'allowed', mode: 'refresher' }
  }

  const tab: CourseTab = input.tab ?? 'learn'

  if (tab === 'learn') {
    const isNew = input.lineState === null || input.lineState.state === 'new'
    if (isNew && input.isChallenge === true) {
      // Challenge courses (tactics packs): the first attempt IS the exercise,
      // so a new line quizzes blind instead of revealing the solution.
      return { kind: 'allowed', mode: 'quiz' }
    }
    return { kind: 'allowed', mode: isNew ? 'teach' : 'refresher' }
  }

  // tab === 'review'
  if (input.lineState === null || input.lineState.state === 'new') {
    return { kind: 'disabled', reason: 'not-due' }
  }
  const isDue = input.lineState.due.getTime() <= input.now.getTime()
  if (!isDue) return { kind: 'disabled', reason: 'not-due' }
  return { kind: 'allowed', mode: 'quiz' }
}
