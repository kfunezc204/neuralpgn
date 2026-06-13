import type { UserSide } from './types.ts'

/**
 * Import-preview heuristic: preselect the "challenge course" toggle when the
 * PGN smells like a tactics pack — every chapter detected as side-to-move
 * (mixed-side puzzle positions). One-sided packs are indistinguishable from
 * repertoires by structure, so they stay off and the user decides.
 */
export function shouldPreselectChallenge(
  chapters: { user_side: UserSide }[],
): boolean {
  return chapters.length > 0 && chapters.every((c) => c.user_side === 'stm')
}
