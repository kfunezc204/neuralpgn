import { describe, it, expect } from 'vitest'
import { evaluateNewLinesGate } from '../NewLinesGate.ts'

describe('NewLinesGate', () => {
  it('allows learning while under the daily limit', () => {
    expect(evaluateNewLinesGate({ newToday: 5, dailyLimit: 20 })).toEqual({
      kind: 'allowed',
    })
  })

  it('warns exactly at the limit (the next new line would exceed it)', () => {
    expect(evaluateNewLinesGate({ newToday: 20, dailyLimit: 20 })).toEqual({
      kind: 'warn',
      newToday: 20,
      dailyLimit: 20,
    })
  })

  it('warns past the limit', () => {
    expect(evaluateNewLinesGate({ newToday: 27, dailyLimit: 20 })).toEqual({
      kind: 'warn',
      newToday: 27,
      dailyLimit: 20,
    })
  })

  it('a limit of 0 disables the gate entirely', () => {
    expect(evaluateNewLinesGate({ newToday: 500, dailyLimit: 0 })).toEqual({
      kind: 'allowed',
    })
  })
})
