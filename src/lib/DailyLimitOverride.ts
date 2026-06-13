// In-memory "continue anyway" flag for the daily new-lines gate. Lives for
// the app session (resets on restart) so accepting the warning once doesn't
// nag on every subsequent new line that same sitting.
let overridden = false

export function isDailyLimitOverridden(): boolean {
  return overridden
}

export function overrideDailyLimit(): void {
  overridden = true
}
