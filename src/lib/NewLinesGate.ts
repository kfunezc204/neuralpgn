export interface NewLinesGateInput {
  /** Distinct lines first learned today (DailySummary.newToday). */
  newToday: number
  /** Profile setting; 0 disables the gate. */
  dailyLimit: number
}

export type NewLinesGateResult =
  | { kind: 'allowed' }
  | { kind: 'warn'; newToday: number; dailyLimit: number }

/**
 * Daily new-lines protection: warns when starting another new line would go
 * past the configured limit. Never blocks — the UI offers an explicit
 * "continue anyway"; a line already in progress is never interrupted.
 */
export function evaluateNewLinesGate(
  input: NewLinesGateInput,
): NewLinesGateResult {
  if (input.dailyLimit <= 0) return { kind: 'allowed' }
  if (input.newToday < input.dailyLimit) return { kind: 'allowed' }
  return {
    kind: 'warn',
    newToday: input.newToday,
    dailyLimit: input.dailyLimit,
  }
}
