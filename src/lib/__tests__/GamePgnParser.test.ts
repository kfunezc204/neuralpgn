import { describe, it, expect } from 'vitest'
import { parseGamesPgn } from '../GamePgnParser.ts'

const LICHESS_GAME = `[Event "Rated blitz game"]
[Site "https://lichess.org/AbCdEfGh"]
[Date "2026.06.28"]
[White "kevin204"]
[Black "rival77"]
[Result "1-0"]
[UTCDate "2026.06.28"]
[UTCTime "18:32:11"]
[Variant "Standard"]
[TimeControl "300+0"]
[Termination "Normal"]

1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 1-0
`

describe('GamePgnParser', () => {
  it('parses a Lichess export game into metadata and mainline moves', () => {
    const games = parseGamesPgn(LICHESS_GAME, 'kevin204')

    expect(games).toHaveLength(1)
    const g = games[0]
    expect(g.white).toBe('kevin204')
    expect(g.black).toBe('rival77')
    expect(g.user_color).toBe('white')
    expect(g.result).toBe('1-0')
    expect(g.time_control).toBe('300+0')
    expect(g.is_standard).toBe(true)
    expect(g.sans).toEqual(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'])
    expect(g.played_at).toBe('2026-06-28T18:32:11.000Z')
    expect(g.dedupe_key).toBe('lichess:AbCdEfGh')
  })

  it('detects the user on the black side case-insensitively, and null when absent', () => {
    const asBlack = parseGamesPgn(LICHESS_GAME, 'RIVAL77')
    expect(asBlack[0].user_color).toBe('black')

    const stranger = parseGamesPgn(LICHESS_GAME, 'nobody')
    expect(stranger[0].user_color).toBe(null)
  })

  it('parses multi-game Chess.com exports with clock comments, hashing games without a Lichess id', () => {
    const pgn = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.06.20"]
[White "rival77"]
[Black "kevin204"]
[Result "0-1"]
[TimeControl "600"]

1. d4 {[%clk 0:09:58]} Nf6 {[%clk 0:09:55]} 2. c4 g6 0-1

[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.06.21"]
[White "kevin204"]
[Black "other"]
[Result "1/2-1/2"]
[TimeControl "600"]

1. e4 e5 1/2-1/2
`
    const games = parseGamesPgn(pgn, 'kevin204')

    expect(games).toHaveLength(2)
    expect(games[0].user_color).toBe('black')
    expect(games[0].sans).toEqual(['d4', 'Nf6', 'c4', 'g6'])
    expect(games[1].user_color).toBe('white')
    expect(games[0].dedupe_key).toMatch(/^hash:/)
    expect(games[0].dedupe_key).not.toBe(games[1].dedupe_key)
    // Re-parsing yields the same identity — this is what makes re-import dedupe work.
    expect(parseGamesPgn(pgn, 'kevin204')[0].dedupe_key).toBe(
      games[0].dedupe_key,
    )
  })

  it('flags variant games and games from a custom position as non-standard', () => {
    const pgn = `[Event "Rated Chess960 game"]
[Site "https://lichess.org/XyZw9876"]
[White "kevin204"]
[Black "rival77"]
[Result "1-0"]
[Variant "Chess960"]
[FEN "nrbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/NRBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 e5 1-0
`
    const games = parseGamesPgn(pgn, 'kevin204')
    expect(games[0].is_standard).toBe(false)
  })
})
