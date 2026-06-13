import type { WalkMode } from './TabModeResolver.ts'

export interface MidWalkExitInput {
  mode: WalkMode
  hasProgress: boolean
}

export type MidWalkExitDecision =
  | { kind: 'silent' }
  | { kind: 'warn'; reason: 'quiz-in-progress' }

export function decideMidWalkExit(
  input: MidWalkExitInput,
): MidWalkExitDecision {
  if (input.mode === 'quiz' && input.hasProgress) {
    return { kind: 'warn', reason: 'quiz-in-progress' }
  }
  return { kind: 'silent' }
}
