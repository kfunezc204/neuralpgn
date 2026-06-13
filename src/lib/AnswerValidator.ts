import { Chess } from 'chess.js'
import type { AnswerVerdict, Card, LineStep } from './types.ts'

function canonicalFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

export class AnswerValidator {
  validate(step: LineStep, card: Card, played: string): AnswerVerdict {
    if (played === step.expected_san) {
      const chess = new Chess(this.fenWithDefaults(card.fen_canonical))
      chess.move(played)
      return {
        kind: 'correct',
        san: played,
        fen_after: canonicalFen(chess.fen()),
      }
    }

    for (const r of card.refutations) {
      if (r.san === played) {
        return {
          kind: 'refutation',
          san: r.san,
          continuation: r.continuation,
          ...(r.comment ? { comment: r.comment } : {}),
        }
      }
    }

    return { kind: 'wrong', played, expected_san: step.expected_san }
  }

  private fenWithDefaults(canon: string): string {
    const parts = canon.split(' ')
    while (parts.length < 6) parts.push(parts.length === 4 ? '0' : '1')
    return parts.join(' ')
  }
}
