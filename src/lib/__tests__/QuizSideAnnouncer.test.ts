import { describe, it, expect } from 'vitest'
import { quizSideAnnouncement } from '../QuizSideAnnouncer.ts'

describe('QuizSideAnnouncer', () => {
  it('announces white-to-move when the FEN active color is "w"', () => {
    const startpos = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    expect(quizSideAnnouncement(startpos)).toBe('¡Juegan blancas!')
  })

  it('announces black-to-move when the FEN active color is "b"', () => {
    const afterE4 =
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    expect(quizSideAnnouncement(afterE4)).toBe('¡Juegan negras!')
  })

  it('falls back to white when the FEN is malformed (defensive — no side field)', () => {
    expect(quizSideAnnouncement('not-a-fen')).toBe('¡Juegan blancas!')
  })
})
