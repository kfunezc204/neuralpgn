import { describe, it, expect } from 'vitest'
import { formatHistoryAsPgnFlow, type SanStyle } from '../MoveNotationFormatter.ts'

describe('formatHistoryAsPgnFlow', () => {
  it('returns no tokens for an empty history', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [],
      initialFen: null,
    })

    expect(tokens).toEqual([])
  })

  it('emits "1." before the first white move (default start)', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [{ kind: 'correct', san: 'e4' }],
      initialFen: null,
    })

    expect(tokens).toEqual([
      { kind: 'move-number', text: '1.' },
      {
        kind: 'san',
        text: 'e4',
        style: 'correct',
        index: 0,
        isCurrentReplay: false,
      },
    ])
  })

  it('does NOT emit "1..." between the white move and its black reply', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        { kind: 'correct', san: 'e4' },
        { kind: 'auto', san: 'e5' },
      ],
      initialFen: null,
    })

    // After "1. e4" we expect a bare "e5" — no "1..." marker.
    expect(tokens).toEqual([
      { kind: 'move-number', text: '1.' },
      {
        kind: 'san',
        text: 'e4',
        style: 'correct',
        index: 0,
        isCurrentReplay: false,
      },
      {
        kind: 'san',
        text: 'e5',
        style: 'auto',
        index: 1,
        isCurrentReplay: false,
      },
    ])
  })

  it('uses "N..." then "N+1." when the chapter starts mid-game with black to move', () => {
    // FEN: black to move on move 5
    const blackOnMove5 = '8/8/8/8/8/8/8/8 b - - 0 5'
    const tokens = formatHistoryAsPgnFlow({
      history: [
        { kind: 'correct', san: 'Nf6' },
        { kind: 'auto', san: 'd4' },
        { kind: 'correct', san: 'e6' },
      ],
      initialFen: blackOnMove5,
    })

    const moveNumberTexts = tokens
      .filter((t) => t.kind === 'move-number')
      .map((t) => (t as { kind: 'move-number'; text: string }).text)
    expect(moveNumberTexts).toEqual(['5...', '6.'])
  })

  it('wrong entries use entry.played as text and style="wrong"', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        { kind: 'correct', san: 'e4' },
        { kind: 'wrong', expected: 'e5', played: 'Nh6' },
      ],
      initialFen: null,
    })

    const sans = tokens.filter((t) => t.kind === 'san')
    expect(sans).toHaveLength(2)
    expect(sans[1]).toMatchObject({
      kind: 'san',
      text: 'Nh6',
      style: 'wrong',
      index: 1,
    })
  })

  it('auto entries emit a plain SAN with style="auto" (no "(auto)" suffix)', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        { kind: 'correct', san: 'e4' },
        { kind: 'auto', san: 'e5' },
      ],
      initialFen: null,
    })

    const lastSan = tokens.filter((t) => t.kind === 'san').at(-1) as {
      text: string
      style: SanStyle
    }
    expect(lastSan.text).toBe('e5')
    expect(lastSan.style).toBe('auto')
    // Specifically: the rendered token text must not include the legacy "(auto)" marker.
    expect(lastSan.text).not.toMatch(/\(auto\)/)
  })

  it('refutation entries emit a wrong-styled played san followed by the parenthetical continuation', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        {
          kind: 'refutation',
          played: 'Bxe4',
          continuation: ['Qh5', 'g6', 'Nf7'],
        },
      ],
      initialFen: null,
    })

    expect(tokens).toEqual([
      { kind: 'move-number', text: '1.' },
      {
        kind: 'san',
        text: 'Bxe4',
        style: 'wrong',
        index: 0,
        isCurrentReplay: false,
      },
      { kind: 'refutation-parens', moves: ['Qh5', 'g6', 'Nf7'] },
    ])
  })

  it('omits the refutation-parens token when continuation is empty', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [{ kind: 'refutation', played: 'Bxe4', continuation: [] }],
      initialFen: null,
    })

    const hasParens = tokens.some((t) => t.kind === 'refutation-parens')
    expect(hasParens).toBe(false)
  })

  it('appends a comment token after a sanned entry that carries a comment', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [{ kind: 'correct', san: 'e4', comment: 'Classical pawn break' }],
      initialFen: null,
    })

    expect(tokens).toEqual([
      { kind: 'move-number', text: '1.' },
      {
        kind: 'san',
        text: 'e4',
        style: 'correct',
        index: 0,
        isCurrentReplay: false,
      },
      { kind: 'comment', text: 'Classical pawn break' },
    ])
  })

  it('appends a comment token after a refutation parenthetical when present', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        {
          kind: 'refutation',
          played: 'Bxe4',
          continuation: ['Qh5', 'g6'],
          comment: 'classic Greek gift refutation',
        },
      ],
      initialFen: null,
    })

    expect(tokens.map((t) => t.kind)).toEqual([
      'move-number',
      'san',
      'refutation-parens',
      'comment',
    ])
  })

  it('does not emit a comment token for an empty comment string', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [{ kind: 'correct', san: 'e4', comment: '' }],
      initialFen: null,
    })

    expect(tokens.some((t) => t.kind === 'comment')).toBe(false)
  })

  it('marks isCurrentReplay=true on the san matching currentReplayIndex (and false on the others)', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        { kind: 'replay', san: 'e4' },
        { kind: 'replay', san: 'e5' },
        { kind: 'replay', san: 'Nf3' },
      ],
      initialFen: null,
      currentReplayIndex: 1,
    })

    const sans = tokens.filter((t) => t.kind === 'san') as Array<{
      text: string
      index: number
      isCurrentReplay: boolean
    }>
    expect(sans.map((s) => s.isCurrentReplay)).toEqual([false, true, false])
  })

  it('leaves every isCurrentReplay false when currentReplayIndex is null/undefined', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [{ kind: 'replay', san: 'e4' }],
      initialFen: null,
      currentReplayIndex: null,
    })

    const san = tokens.find((t) => t.kind === 'san') as { isCurrentReplay: boolean }
    expect(san.isCurrentReplay).toBe(false)
  })

  it('rolls into "2." on the third ply', () => {
    const tokens = formatHistoryAsPgnFlow({
      history: [
        { kind: 'correct', san: 'e4' },
        { kind: 'auto', san: 'e5' },
        { kind: 'correct', san: 'Nf3' },
      ],
      initialFen: null,
    })

    const moveNumberTexts = tokens
      .filter((t) => t.kind === 'move-number')
      .map((t) => (t as { kind: 'move-number'; text: string }).text)
    expect(moveNumberTexts).toEqual(['1.', '2.'])
  })
})
