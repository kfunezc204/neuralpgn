import { describe, it, expect } from 'vitest'
import { PendingDeviationsResolver } from '../PendingDeviationsResolver.ts'

const action = (
  game_id: number,
  card_id: number,
  played_san: string,
  kind: 'sent' | 'dismissed' = 'sent',
) => ({ game_id, card_id, played_san, action: kind })

describe('PendingDeviationsResolver', () => {
  it('everything is pending when no actions exist', () => {
    const r = new PendingDeviationsResolver([])
    expect(r.isPending(1, 'Bc4', [101])).toBe(true)
  })

  it('a sent or dismissed action hides exactly that deviation', () => {
    const r = new PendingDeviationsResolver([
      action(1, 101, 'Bc4', 'sent'),
      action(2, 101, 'Nf3', 'dismissed'),
    ])

    expect(r.isPending(1, 'Bc4', [101])).toBe(false)
    expect(r.isPending(2, 'Nf3', [101])).toBe(false)
    // Same card + move in ANOTHER game is a different deviation.
    expect(r.isPending(3, 'Bc4', [101])).toBe(true)
    // Same game + card but a different played move is a different deviation.
    expect(r.isPending(1, 'Qh5', [101])).toBe(true)
  })

  it('matches when the acted-on card is any of the courses expecting a move there', () => {
    // Two courses covered this position (cards 101 and 205); the action was
    // recorded against 101. Deleting course A must not resurrect the row.
    const r = new PendingDeviationsResolver([action(1, 101, 'Bc4')])
    expect(r.isPending(1, 'Bc4', [205, 101])).toBe(false)
    expect(r.isPending(1, 'Bc4', [205])).toBe(true)
  })
})
