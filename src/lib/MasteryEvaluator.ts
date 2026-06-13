export const MASTERY_STABILITY_DAYS = 21
export const MASTERY_CONSECUTIVE_CORRECT = 3

export interface MasteryInput {
  stability: number
  consecutive_correct: number
}

export class MasteryEvaluator {
  isMastered(input: MasteryInput): boolean {
    return (
      input.stability >= MASTERY_STABILITY_DAYS &&
      input.consecutive_correct >= MASTERY_CONSECUTIVE_CORRECT
    )
  }
}

// SQL encoding of the SAME rule as isMastered, for Repository counters that
// aggregate in SQLite instead of loading LineSrsStates into memory. The two
// encodings live together so the mastery rule changes in one file only — keep
// them in lockstep. `alias` is the table alias holding stability /
// consecutive_correct columns (e.g. 'ls' for line_states). Operands are our own
// numeric constants, never user input, so inlining them is injection-safe.
export function masteryPredicateSql(alias = 'ls'): string {
  return (
    `(${alias}.stability >= ${MASTERY_STABILITY_DAYS} ` +
    `AND ${alias}.consecutive_correct >= ${MASTERY_CONSECUTIVE_CORRECT})`
  )
}
