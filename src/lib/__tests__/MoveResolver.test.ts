import { describe, it, expect } from 'vitest'
import {
  expandSanSequence,
  findConnectingMove,
  legalDests,
  resolveMove,
  sanToFromTo,
} from '../MoveResolver.ts'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('MoveResolver — findConnectingMove', () => {
  const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
  const AFTER_E4_E5 =
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

  it('recovers the single move that connects two consecutive positions', () => {
    expect(findConnectingMove(START, AFTER_E4)).toEqual({
      san: 'e4',
      from: 'e2',
      to: 'e4',
    })
    expect(findConnectingMove(AFTER_E4, AFTER_E4_E5)).toEqual({
      san: 'e5',
      from: 'e7',
      to: 'e5',
    })
  })

  it('returns null when no single legal move connects the positions', () => {
    // Two plies apart — not reachable in one move.
    expect(findConnectingMove(START, AFTER_E4_E5)).toBeNull()
    // Identical position.
    expect(findConnectingMove(START, START)).toBeNull()
  })

  it('accepts canonical 4-field FENs on both sides', () => {
    const canon = (fen: string) => fen.split(' ').slice(0, 4).join(' ')
    expect(findConnectingMove(canon(AFTER_E4), canon(AFTER_E4_E5))).toEqual({
      san: 'e5',
      from: 'e7',
      to: 'e5',
    })
  })
})

describe('MoveResolver — resolveMove', () => {
  it('resolves a legal pawn push from the initial position', () => {
    const result = resolveMove(START, 'e2', 'e4')
    expect(result).not.toBeNull()
    expect(result!.san).toBe('e4')
    expect(result!.uci).toBe('e2e4')
    expect(result!.fen_after.startsWith('rnbqkbnr/pppppppp/8/8/4P3')).toBe(true)
  })

  it('returns null for an illegal move in the given position', () => {
    // e2-e5 is two squares but blocked by no piece — pawn can't jump that far from e2
    expect(resolveMove(START, 'e2', 'e5')).toBeNull()
    // Wrong side to move: black trying to move from initial position
    expect(resolveMove(START, 'e7', 'e5')).toBeNull()
  })
})

describe('MoveResolver — legalDests', () => {
  it('returns a map from each piece square to its legal target squares', () => {
    const dests = legalDests(START)
    // e2 pawn can push to e3 and e4
    expect(dests.get('e2')?.sort()).toEqual(['e3', 'e4'])
    // g1 knight can jump to f3 and h3
    expect(dests.get('g1')?.sort()).toEqual(['f3', 'h3'])
    // Black's pieces have no entries (not their move)
    expect(dests.get('e7')).toBeUndefined()
  })
})

describe('MoveResolver — expandSanSequence', () => {
  it('walks a SAN sequence and yields fen_before/fen_after per step', () => {
    const steps = expandSanSequence(START, ['e4', 'e5', 'Nf3'])
    expect(steps).toHaveLength(3)
    expect(steps[0].san).toBe('e4')
    expect(steps[0].fen_before).toBe(START)
    expect(steps[1].fen_before).toBe(steps[0].fen_after)
    expect(steps[2].fen_before).toBe(steps[1].fen_after)
  })

  it('stops at the first illegal SAN', () => {
    const steps = expandSanSequence(START, ['e4', 'Qd7'])
    expect(steps).toHaveLength(1)
    expect(steps[0].san).toBe('e4')
  })
})

describe('MoveResolver — sanToFromTo', () => {
  it('returns the from/to squares for a legal SAN in the given position', () => {
    expect(sanToFromTo(START, 'e4')).toEqual({ from: 'e2', to: 'e4' })
    expect(sanToFromTo(START, 'Nf3')).toEqual({ from: 'g1', to: 'f3' })
  })

  it('returns null when SAN is not legal in the position', () => {
    expect(sanToFromTo(START, 'Qd5')).toBeNull()
  })
})
