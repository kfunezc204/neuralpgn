import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PgnIngestor } from '../PgnIngestor.ts'
import type { IngestResult } from '../types.ts'

// Real-corpus regression tests over the PGNs the app is actually used with
// (PRD "Testing Decisions" makes these mandatory). The exact counts are
// snapshots of current ingest behavior: if a deliberate ingestor change shifts
// them, update the numbers — an accidental shift is a regression.
//
// The fixtures live at the repo root (tracked despite the *.pgn ignore rule).
// Skip gracefully if a checkout is missing them.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const WOODPECKER = join(ROOT, 'The Woodpecker Method (September 2024).pgn')
const SCOTCH = join(ROOT, '109 - Scotch Game + Homework Download.pgn')

function structuralInvariants(result: IngestResult) {
  const cardIds = new Set(result.cards.map((c) => c.id))
  for (const line of result.lines) {
    // No empty lines (they would complete instantly and self-grade Good).
    expect(line.steps.length).toBeGreaterThan(0)
    for (const step of line.steps) {
      // Every step resolves to an emitted card and no Z0 survives expansion.
      expect(cardIds.has(step.card_id)).toBe(true)
      expect(step.expected_san).not.toBe('Z0')
    }
  }
  // Card-position dedup: FENs are unique within a chapter.
  const seen = new Set<string>()
  for (const card of result.cards) {
    const key = `${card.chapter_id}|${card.fen_canonical}`
    expect(seen.has(key)).toBe(false)
    seen.add(key)
  }
}

describe.skipIf(!existsSync(WOODPECKER))(
  'PgnIngestor — Woodpecker Method fixture (tactics corpus)',
  () => {
    it(
      'ingests 1131 exercises into 8 stm chapters with one line per DFS leaf and per-exercise intros',
      { timeout: 30_000 },
      () => {
        const text = readFileSync(WOODPECKER, 'utf8')
        const result = new PgnIngestor().ingest(text)

        expect(result.chapters).toHaveLength(8)
        expect(result.chapters.map((c) => c.name)).toContain(
          '4) Easy Exercises',
        )
        expect(result.chapters.map((c) => c.name)).toContain(
          '8) Advanced Exercises',
        )
        // Mixed side-to-move FENs within every chapter → stm.
        for (const ch of result.chapters) {
          expect(ch.user_side).toBe('stm')
        }

        expect(result.lines).toHaveLength(3064)
        expect(result.cards).toHaveLength(11626)
        const easy = result.chapters.find(
          (c) => c.name === '4) Easy Exercises',
        )!
        expect(easy.line_ids).toHaveLength(367)

        // Every exercise keeps its own intro comment on its lines.
        expect(result.lines.every((l) => l.intro_comment)).toBe(true)

        // The only warnings are the file's 10 Z0s without a listed variation.
        expect(result.warnings).toHaveLength(10)
        expect(result.warnings.every((w) => w.code === 'z0_no_variation')).toBe(
          true,
        )

        structuralInvariants(result)
      },
    )
  },
)

describe.skipIf(!existsSync(SCOTCH))(
  'PgnIngestor — Scotch Game fixture (dense opening tree + Z0)',
  () => {
    it(
      'ingests the repertoire into 1 chapter using the resolver-chosen side, expanding all 109 Z0 tokens',
      { timeout: 30_000 },
      () => {
        const text = readFileSync(SCOTCH, 'utf8')
        let resolverCalls = 0
        const result = new PgnIngestor().ingest(text, {
          resolveStartingSide: (p) => {
            resolverCalls++
            expect(p.starts_from_initial_position).toBe(true)
            return 'white'
          },
        })

        // No FEN tags → the side comes from the resolver, asked exactly once.
        expect(resolverCalls).toBe(1)
        expect(result.chapters).toHaveLength(1)
        expect(result.chapters[0].name).toBe('Scotch Game')
        expect(result.chapters[0].user_side).toBe('white')

        expect(result.lines).toHaveLength(139)
        expect(result.cards).toHaveLength(351)

        // Z0 handling is observable in the warnings: 27 of the file's 109 Z0s
        // have no listed variation (branch truncated), plus one mainline that
        // becomes illegal after Z0 substitution (branch truncated too).
        const byCode = new Map<string, number>()
        for (const w of result.warnings) {
          byCode.set(w.code, (byCode.get(w.code) ?? 0) + 1)
        }
        expect(byCode.get('z0_no_variation')).toBe(27)
        expect(byCode.get('pgn_parse_error')).toBe(1)
        expect(result.warnings).toHaveLength(28)

        // Opponent moves tagged $2 materialize as trainable sibling lines (how
        // to punish them), not as refutations — refutations only apply to bad
        // USER moves, and this file has none.
        expect(result.cards.every((c) => c.refutations.length === 0)).toBe(true)

        structuralInvariants(result)
      },
    )
  },
)

describe('PgnIngestor — malformed input', () => {
  it('returns an empty result with a pgn_parse_error warning for non-PGN garbage', () => {
    const result = new PgnIngestor().ingest('this is not a pgn at all {{{')
    expect(result.chapters).toEqual([])
    expect(result.lines).toEqual([])
    expect(result.cards).toEqual([])
    expect(result.warnings.map((w) => w.code)).toContain('pgn_parse_error')
  })

  it('truncates a line at an illegal move WITHOUT emitting the unplayable step', () => {
    const result = new PgnIngestor().ingest(
      '[Event "x"]\n[White "Broken"]\n\n1. e4 e5 2. Kxe8 *',
    )
    expect(result.warnings.map((w) => w.code)).toContain('pgn_parse_error')
    expect(result.lines).toHaveLength(1)
    // The illegal Kxe8 never becomes an expected_san the trainee can't play.
    expect(result.lines[0].steps.map((s) => s.expected_san)).toEqual(['e4'])
  })
})
