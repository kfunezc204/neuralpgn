import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { AnswerValidator } from '../AnswerValidator.ts'
import type { Card, LineStep } from '../types.ts'

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function fenAfter(fen: string, san: string): string {
  const chess = new Chess(fen)
  chess.move(san)
  return chess.fen().split(' ').slice(0, 4).join(' ')
}

const cardFromInitial: Card = {
  id: 'card_0',
  chapter_id: 'chapter_0',
  fen_canonical: STARTING_FEN.split(' ').slice(0, 4).join(' '),
  refutations: [],
}

const step: LineStep = { card_id: 'card_0', expected_san: 'e4' }

describe('AnswerValidator — line-strict model', () => {
  it('returns correct when played SAN matches step.expected_san', () => {
    const verdict = new AnswerValidator().validate(step, cardFromInitial, 'e4')

    expect(verdict.kind).toBe('correct')
    if (verdict.kind === 'correct') {
      expect(verdict.san).toBe('e4')
      expect(verdict.fen_after).toBe(fenAfter(STARTING_FEN, 'e4'))
    }
  })

  it('returns wrong when played SAN differs from expected_san and card has no refutations', () => {
    // d4 is a legal move from the initial position but not the expected one
    // for this line, and the card defines no refutations.
    const verdict = new AnswerValidator().validate(step, cardFromInitial, 'd4')

    expect(verdict.kind).toBe('wrong')
    if (verdict.kind === 'wrong') {
      expect(verdict.played).toBe('d4')
      // The wrong verdict must carry the expected SAN so the UI can reveal and
      // highlight the correct move after a double-fail (PRD D6 / US28).
      expect(verdict.expected_san).toBe('e4')
    }
  })

  it('returns refutation with continuation and comment when played SAN matches a refutation', () => {
    const cardWithRefutation: Card = {
      id: 'card_0',
      chapter_id: 'chapter_0',
      fen_canonical: STARTING_FEN.split(' ').slice(0, 4).join(' '),
      refutations: [
        {
          san: 'f3',
          continuation: ['e5', 'g4', 'Qh4#'],
          comment: 'Fool’s mate.',
        },
      ],
    }

    const verdict = new AnswerValidator().validate(
      step,
      cardWithRefutation,
      'f3',
    )

    expect(verdict.kind).toBe('refutation')
    if (verdict.kind === 'refutation') {
      expect(verdict.san).toBe('f3')
      expect(verdict.continuation).toEqual(['e5', 'g4', 'Qh4#'])
      expect(verdict.comment).toBe('Fool’s mate.')
    }
  })

  it('refutation takes precedence over wrong when played SAN matches both an unmentioned move and a refutation entry', () => {
    const cardWithRefutation: Card = {
      id: 'card_0',
      chapter_id: 'chapter_0',
      fen_canonical: STARTING_FEN.split(' ').slice(0, 4).join(' '),
      refutations: [{ san: 'a3', continuation: ['e5'] }],
    }

    // a3 is legal from the initial position; not equal to step.expected_san ('e4'),
    // but listed as a refutation. Must be reported as refutation, not wrong.
    const verdict = new AnswerValidator().validate(
      step,
      cardWithRefutation,
      'a3',
    )
    expect(verdict.kind).toBe('refutation')
  })
})
