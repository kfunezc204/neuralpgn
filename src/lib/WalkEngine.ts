import { AnswerValidator } from './AnswerValidator.ts'
import type {
  AnswerVerdict,
  BoardShape,
  Card,
  Line,
  LineOutcome,
  LineStep,
} from './types.ts'

export type WalkStep =
  | {
      kind: 'teach'
      card_id: string
      fen: string
      san: string
      comment?: string
      shapes?: BoardShape[]
    }
  | {
      kind: 'autoplay'
      card_id: string
      fen: string
      san: string
    }
  | {
      kind: 'quiz'
      card_id: string
      fen: string
      retry_used: boolean
    }
  | {
      kind: 'refutation-continuation'
      card_id: string
      fen: string
      san: string
      continuation: string[]
      comment?: string
    }
  | {
      kind: 'replay'
      card_id: string
      fen: string
      san: string
      comment?: string
      shapes?: BoardShape[]
      stepIndex: number
      totalSteps: number
    }
  | { kind: 'done' }

export type QuizSubmitResult =
  | { status: 'retry'; verdict: AnswerVerdict }
  | {
      status: 'resolved'
      verdict: AnswerVerdict
    }

type Mode = 'quiz' | 'teach' | 'refresher' | 'replay'

export interface WalkEngineOptions {
  dominatedSiblings?: Line[]
}

function longestCommonStepsPrefix(target: Line, other: Line): number {
  const min = Math.min(target.steps.length, other.steps.length)
  let i = 0
  while (
    i < min &&
    target.steps[i].card_id === other.steps[i].card_id &&
    target.steps[i].expected_san === other.steps[i].expected_san
  ) {
    i++
  }
  return i
}

export class WalkEngine {
  static quiz(
    line: Line,
    cards: Card[],
    opts: WalkEngineOptions = {},
  ): WalkEngine {
    return new WalkEngine('quiz', line, cards, opts)
  }

  static teach(
    line: Line,
    cards: Card[],
    opts: WalkEngineOptions = {},
  ): WalkEngine {
    return new WalkEngine('teach', line, cards, opts)
  }

  static refresher(
    line: Line,
    cards: Card[],
    opts: WalkEngineOptions = {},
  ): WalkEngine {
    return new WalkEngine('refresher', line, cards, opts)
  }

  static replay(line: Line, cards: Card[]): WalkEngine {
    return new WalkEngine('replay', line, cards, {})
  }

  get affectsScheduler(): boolean {
    return this.mode !== 'refresher' && this.mode !== 'replay'
  }

  /**
   * True when every step resolves to autoplay — the dominated-sibling prefix
   * plus opponent responses cover the whole line, so the walk runs to 'done'
   * with zero trainee input. Completing such a walk proves nothing; callers
   * must not let it write SRS state (it would silently self-grade Good).
   */
  get isFullyAutoplayed(): boolean {
    for (let i = this.prefixAutoplayLen; i < this.line.steps.length; i++) {
      const card = this.cardsById.get(this.line.steps[i].card_id)
      if (card && !this.isOpponentStep(card)) return false
    }
    return true
  }

  private readonly cardsById: Map<string, Card>
  private readonly prefixAutoplayLen: number
  private idx = 0
  private readonly quizzedSteps = new Set<number>()
  private retryUsed = false
  private anyRetryUsed = false
  private totalRetries = 0
  private failed = false
  private hintUsed = false
  private pendingRefutation: {
    card_id: string
    fen: string
    san: string
    continuation: string[]
    comment?: string
  } | null = null

  private constructor(
    private readonly mode: Mode,
    private readonly line: Line,
    cards: Card[],
    opts: WalkEngineOptions = {},
    private readonly validator: AnswerValidator = new AnswerValidator(),
  ) {
    this.cardsById = new Map(cards.map((c) => [c.id, c]))
    let maxPrefix = 0
    for (const sib of opts.dominatedSiblings ?? []) {
      // The line under walk may itself be dominated (mastered lines come back
      // due) and callers pass the chapter's dominated set unfiltered. Matching
      // against itself would autoplay the whole line and self-grade Good.
      if (sib.id === line.id) continue
      const n = longestCommonStepsPrefix(line, sib)
      if (n > maxPrefix) maxPrefix = n
    }
    // A sibling that fully contains this line as a prefix would also skip the
    // whole quiz; keep at least the final step interactive.
    this.prefixAutoplayLen = Math.min(
      maxPrefix,
      Math.max(0, line.steps.length - 1),
    )
  }

  current(): WalkStep {
    if (this.pendingRefutation) {
      const r = this.pendingRefutation
      const step: WalkStep = {
        kind: 'refutation-continuation',
        card_id: r.card_id,
        fen: r.fen,
        san: r.san,
        continuation: r.continuation,
      }
      if (r.comment) (step as { comment?: string }).comment = r.comment
      return step
    }
    if (this.idx >= this.line.steps.length) return { kind: 'done' }
    const step = this.line.steps[this.idx]
    const card = this.cardById(step)

    if (
      this.mode === 'refresher' ||
      this.failed ||
      this.idx < this.prefixAutoplayLen
    ) {
      return {
        kind: 'autoplay',
        card_id: card.id,
        fen: card.fen_canonical,
        san: step.expected_san,
      }
    }

    // 'stm' chapters (e.g. tactics puzzles) keep opponent moves in line.steps
    // so the board can advance through the full sequence. The trainee only
    // plays the side-to-move at the start of the line; opponent responses
    // auto-play in both teach and quiz modes.
    if (this.isOpponentStep(card)) {
      return {
        kind: 'autoplay',
        card_id: card.id,
        fen: card.fen_canonical,
        san: step.expected_san,
      }
    }

    if (this.mode === 'quiz') {
      return {
        kind: 'quiz',
        card_id: card.id,
        fen: card.fen_canonical,
        retry_used: this.retryUsed,
      }
    }

    // teach mode (Phase 4)
    const teach: WalkStep = {
      kind: 'teach',
      card_id: card.id,
      fen: card.fen_canonical,
      san: step.expected_san,
    }
    if (card.comment) (teach as { comment?: string }).comment = card.comment
    if (card.shapes) (teach as { shapes?: BoardShape[] }).shapes = card.shapes
    return teach
  }

  submit(played: string): QuizSubmitResult {
    if (this.mode !== 'quiz' || this.idx >= this.line.steps.length) {
      throw new Error('submit only valid in quiz mode on an active step')
    }
    if (this.failed) {
      throw new Error('cannot submit after line has already failed')
    }
    const step = this.line.steps[this.idx]
    const card = this.cardById(step)
    this.quizzedSteps.add(this.idx)
    const verdict = this.validator.validate(step, card, played)

    if (verdict.kind === 'correct') {
      if (this.retryUsed) this.anyRetryUsed = true
      return { status: 'resolved', verdict }
    }
    if (verdict.kind === 'refutation') {
      this.failed = true
      this.pendingRefutation = {
        card_id: card.id,
        fen: card.fen_canonical,
        san: verdict.san,
        continuation: verdict.continuation,
        ...(verdict.comment ? { comment: verdict.comment } : {}),
      }
      return { status: 'resolved', verdict }
    }
    if (!this.retryUsed) {
      this.retryUsed = true
      this.totalRetries++
      return { status: 'retry', verdict }
    }
    this.failed = true
    return { status: 'resolved', verdict }
  }

  advance(): void {
    if (this.pendingRefutation) {
      this.pendingRefutation = null
      this.idx++
      this.retryUsed = false
      return
    }
    if (this.idx >= this.line.steps.length) return
    this.idx++
    this.retryUsed = false
  }

  lineOutcome(): LineOutcome {
    if (this.mode === 'replay') {
      throw new Error('lineOutcome is invalid in replay mode')
    }
    if (this.failed) return 'fail'
    if (this.anyRetryUsed || this.hintUsed) return 'pass_with_retry'
    return 'pass_all_first'
  }

  next(): void {
    if (this.mode !== 'replay') {
      throw new Error('next() is only valid in replay mode')
    }
    const last = this.line.steps.length - 1
    if (this.idx < last) this.idx++
  }

  prev(): void {
    if (this.mode !== 'replay') {
      throw new Error('prev() is only valid in replay mode')
    }
    if (this.idx > 0) this.idx--
  }

  jumpTo(i: number): void {
    if (this.mode !== 'replay') {
      throw new Error('jumpTo() is only valid in replay mode')
    }
    const last = this.line.steps.length - 1
    if (i < 0) this.idx = 0
    else if (i > last) this.idx = last
    else this.idx = i
  }

  currentStep(): WalkStep {
    if (this.mode !== 'replay') {
      throw new Error('currentStep() is only valid in replay mode')
    }
    const total = this.line.steps.length
    if (total === 0) return { kind: 'done' }
    const step = this.line.steps[this.idx]
    const card = this.cardById(step)
    const out: WalkStep = {
      kind: 'replay',
      card_id: card.id,
      fen: card.fen_canonical,
      san: step.expected_san,
      stepIndex: this.idx,
      totalSteps: total,
    }
    if (card.comment) (out as { comment?: string }).comment = card.comment
    if (card.shapes) (out as { shapes?: BoardShape[] }).shapes = card.shapes
    return out
  }

  hint(): { comment?: string; shapes?: BoardShape[] } {
    if (this.mode !== 'quiz') {
      throw new Error('hint only valid in quiz mode')
    }
    if (this.idx >= this.line.steps.length) {
      throw new Error('hint requested past the last step')
    }
    const step = this.line.steps[this.idx]
    const card = this.cardById(step)
    // Only cap the outcome when the hint actually revealed something —
    // a comment, author shapes, or both.
    if (!card.comment && !card.shapes) return {}
    this.hintUsed = true
    return {
      ...(card.comment ? { comment: card.comment } : {}),
      ...(card.shapes ? { shapes: card.shapes } : {}),
    }
  }

  progress(): { idx: number; total: number } {
    return { idx: this.idx, total: this.line.steps.length }
  }

  /** Number of distinct steps the trainee was actually quizzed on. */
  quizzedCount(): number {
    return this.quizzedSteps.size
  }

  /** Total retries granted across the whole line (one max per step). */
  retriesUsed(): number {
    return this.totalRetries
  }

  private cardById(step: LineStep): Card {
    const card = this.cardsById.get(step.card_id)
    if (!card) {
      throw new Error(`card not found: ${step.card_id}`)
    }
    return card
  }

  private isOpponentStep(card: Card): boolean {
    const firstStep = this.line.steps[0]
    if (!firstStep) return false
    const firstCard = this.cardsById.get(firstStep.card_id)
    if (!firstCard) return false
    return stmOf(card) !== stmOf(firstCard)
  }
}

function stmOf(card: Card): 'w' | 'b' {
  return card.fen_canonical.split(' ')[1] === 'b' ? 'b' : 'w'
}
