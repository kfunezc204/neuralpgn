import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { PgnIngestor } from '../PgnIngestor.ts'
import { WalkEngine } from '../WalkEngine.ts'
import { LineScheduler } from '../LineScheduler.ts'
import type { Card, Line } from '../types.ts'

function canon(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

const LINEAR_PGN = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

function buildEngine() {
  const { lines, cards } = new PgnIngestor().ingest(LINEAR_PGN)
  const line = lines[0]
  return { engine: WalkEngine.quiz(line, cards), line }
}

describe('WalkEngine — quiz mode line-driven', () => {
  it('walks a line with every step answered correctly at first attempt and reports pass_all_first', () => {
    const { engine, line } = buildEngine()

    let steps = 0
    while (true) {
      const cur = engine.current()
      if (cur.kind === 'done') break
      expect(cur.kind).toBe('quiz')
      if (cur.kind === 'quiz') {
        const expected = line.steps[steps].expected_san
        const result = engine.submit(expected)
        expect(result.status).toBe('resolved')
        engine.advance()
        steps++
      }
    }

    expect(steps).toBe(line.steps.length)
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })

  it('quizzedCount reports the exact number of distinct steps the trainee was quizzed on', () => {
    const { engine, line } = buildEngine()

    let quizzed = 0
    while (true) {
      const cur = engine.current()
      if (cur.kind === 'done') break
      if (cur.kind === 'quiz') {
        const idx = engine.progress().idx
        engine.submit(line.steps[idx].expected_san)
        quizzed++
      }
      engine.advance()
    }

    expect(quizzed).toBeGreaterThan(0)
    expect(engine.quizzedCount()).toBe(quizzed)
  })

  it('reports pass_with_retry when at least one step is solved on the 2nd attempt and the rest at 1st', () => {
    const { engine, line } = buildEngine()

    // Step 0: play wrong first, then correct (retry used).
    let cur = engine.current()
    expect(cur.kind).toBe('quiz')
    const wrongFirst = engine.submit('a3') // legal but not expected
    expect(wrongFirst.status).toBe('retry')
    const correctSecond = engine.submit(line.steps[0].expected_san)
    expect(correctSecond.status).toBe('resolved')
    expect(correctSecond.verdict.kind).toBe('correct')
    engine.advance()

    // Step 1+: play correct first attempt.
    for (let i = 1; i < line.steps.length; i++) {
      cur = engine.current()
      expect(cur.kind).toBe('quiz')
      const r = engine.submit(line.steps[i].expected_san)
      expect(r.status).toBe('resolved')
      engine.advance()
    }

    expect(engine.current().kind).toBe('done')
    expect(engine.lineOutcome()).toBe('pass_with_retry')
  })

  it('on a double-fail at a step the line outcome is fail and remaining steps become autoplay', () => {
    const { engine, line } = buildEngine()
    expect(line.steps.length).toBeGreaterThanOrEqual(2)

    // Step 0: wrong twice (both legal but not expected SANs).
    const cur = engine.current()
    expect(cur.kind).toBe('quiz')
    const first = engine.submit('a3')
    expect(first.status).toBe('retry')
    const second = engine.submit('a4')
    expect(second.status).toBe('resolved')
    expect(second.verdict.kind).toBe('wrong')
    engine.advance()

    // After failure, remaining steps must be 'autoplay' (no more quiz prompts).
    for (let i = 1; i < line.steps.length; i++) {
      const s = engine.current()
      expect(s.kind).toBe('autoplay')
      if (s.kind === 'autoplay') {
        expect(s.san).toBe(line.steps[i].expected_san)
      }
      engine.advance()
    }

    expect(engine.current().kind).toBe('done')
    expect(engine.lineOutcome()).toBe('fail')
  })
})

describe('WalkEngine — refutation handling', () => {
  // Synthetic 3-step line so we control refutations precisely.
  // Real SAN validity isn't required for these tests because Validator
  // matches refutation by string only and "correct" via expected_san match.
  const STARTING_FEN_CANON =
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'

  // First user-turn position: real starting FEN so 'd4' actually moves a piece.
  const cards: Card[] = [
    {
      id: 'card_A',
      chapter_id: 'ch',
      fen_canonical: STARTING_FEN_CANON,
      refutations: [
        {
          san: 'd4',
          continuation: ['e5', 'Nf3'],
          comment: 'd4 lets black equalize.',
        },
      ],
    },
    // The subsequent FENs are placeholders — the engine never validates
    // legality on autoplay steps (it only echoes expected_san).
    {
      id: 'card_B',
      chapter_id: 'ch',
      fen_canonical: 'fake_fen_B',
      refutations: [],
    },
    {
      id: 'card_C',
      chapter_id: 'ch',
      fen_canonical: 'fake_fen_C',
      refutations: [],
    },
  ]

  const line: Line = {
    id: 'line_X',
    chapter_id: 'ch',
    dfs_index: 0,
    steps: [
      { card_id: 'card_A', expected_san: 'e4' },
      { card_id: 'card_B', expected_san: 'Nf3' },
      { card_id: 'card_C', expected_san: 'Bc4' },
    ],
  }

  it('submitting a refuted SAN resolves immediately as fail (no retry), exposes a refutation-continuation step, then autoplays the remaining mainline', () => {
    const engine = WalkEngine.quiz(line, cards)

    // Step 0 is a quiz prompt.
    expect(engine.current().kind).toBe('quiz')

    // User plays the refuted SAN.
    const result = engine.submit('d4')
    expect(result.status).toBe('resolved')
    expect(result.verdict.kind).toBe('refutation')

    // Line outcome is already 'fail' — refutation skips retry.
    expect(engine.lineOutcome()).toBe('fail')

    // Next current() yields the refutation-continuation pseudo-step.
    const refStep = engine.current()
    expect(refStep.kind).toBe('refutation-continuation')
    if (refStep.kind === 'refutation-continuation') {
      expect(refStep.san).toBe('d4')
      expect(refStep.continuation).toEqual(['e5', 'Nf3'])
      expect(refStep.comment).toBe('d4 lets black equalize.')
      expect(refStep.card_id).toBe('card_A')
    }

    // Advance past the refutation continuation.
    engine.advance()

    // Remaining mainline steps must be 'autoplay' (no quiz prompt after fail).
    const autoplay1 = engine.current()
    expect(autoplay1.kind).toBe('autoplay')
    if (autoplay1.kind === 'autoplay') {
      expect(autoplay1.san).toBe('Nf3')
      expect(autoplay1.card_id).toBe('card_B')
    }
    engine.advance()

    const autoplay2 = engine.current()
    expect(autoplay2.kind).toBe('autoplay')
    if (autoplay2.kind === 'autoplay') {
      expect(autoplay2.san).toBe('Bc4')
    }
    engine.advance()

    expect(engine.current().kind).toBe('done')
    expect(engine.lineOutcome()).toBe('fail')
  })

  it('does not grant a retry when the first attempt is a refutation', () => {
    const engine = WalkEngine.quiz(line, cards)

    const result = engine.submit('d4') // refuted
    expect(result.status).toBe('resolved') // NOT 'retry'

    // submit() after a refutation must throw — the line is already failed.
    expect(() => engine.submit('e4')).toThrow()
  })
})

describe('WalkEngine — dominated-sibling prefix autoplay', () => {
  // Real FENs from a Chess instance, so the AnswerValidator's 'correct' path
  // (which constructs a Chess from card.fen_canonical) works.
  function fenAt(moves: string[]): string {
    const ch = new Chess()
    for (const m of moves) ch.move(m)
    return canon(ch.fen())
  }

  // Lines share the user-turn cards at idx 0 and 1; idx 2 is the same position
  // for both (same card_id) but the expected_san differs, so the shared prefix
  // ends at length 2. idx 3 lands on a distinct position per line.
  const sharedCards: Card[] = [
    { id: 'c0', chapter_id: 'ch', fen_canonical: fenAt([]), refutations: [] },
    {
      id: 'c1',
      chapter_id: 'ch',
      fen_canonical: fenAt(['e4', 'e5']),
      refutations: [],
    },
    {
      id: 'c2',
      chapter_id: 'ch',
      fen_canonical: fenAt(['e4', 'e5', 'Nf3', 'Nc6']),
      refutations: [],
    },
    {
      id: 'c3_A',
      chapter_id: 'ch',
      fen_canonical: fenAt(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']),
      refutations: [],
    },
    {
      id: 'c3_B',
      chapter_id: 'ch',
      fen_canonical: fenAt(['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4']),
      refutations: [],
    },
  ]

  const lineA: Line = {
    id: 'A',
    chapter_id: 'ch',
    dfs_index: 0,
    steps: [
      { card_id: 'c0', expected_san: 'e4' },
      { card_id: 'c1', expected_san: 'Nf3' },
      { card_id: 'c2', expected_san: 'Bc4' },
      { card_id: 'c3_A', expected_san: 'O-O' },
    ],
  }

  const lineB: Line = {
    id: 'B',
    chapter_id: 'ch',
    dfs_index: 1,
    steps: [
      { card_id: 'c0', expected_san: 'e4' },
      { card_id: 'c1', expected_san: 'Nf3' },
      { card_id: 'c2', expected_san: 'd4' },
      { card_id: 'c3_B', expected_san: 'c3' },
    ],
  }

  it('autoplays the first N steps that match a dominated sibling line, then starts the quiz at step N', () => {
    // Walking line B with line A marked dominated → first 2 steps autoplay.
    const engine = WalkEngine.quiz(lineB, sharedCards, {
      dominatedSiblings: [lineA],
    })

    const step0 = engine.current()
    expect(step0.kind).toBe('autoplay')
    if (step0.kind === 'autoplay') {
      expect(step0.san).toBe('e4')
      expect(step0.card_id).toBe('c0')
    }
    engine.advance()

    const step1 = engine.current()
    expect(step1.kind).toBe('autoplay')
    if (step1.kind === 'autoplay') {
      expect(step1.san).toBe('Nf3')
      expect(step1.card_id).toBe('c1')
    }
    engine.advance()

    // First divergent step — must be a quiz prompt for line B.
    const step2 = engine.current()
    expect(step2.kind).toBe('quiz')
    if (step2.kind === 'quiz') {
      expect(step2.card_id).toBe('c2')
      expect(step2.retry_used).toBe(false)
    }
  })

  it('ignores the line itself in the dominated set — a mastered line coming back due is still quizzed in full', () => {
    // Callers pass the chapter's dominated lines unfiltered, so the line under
    // walk can appear in its own dominated set once mastered.
    const engine = WalkEngine.quiz(lineB, sharedCards, {
      dominatedSiblings: [lineB],
    })
    expect(engine.current().kind).toBe('quiz')
    expect(engine.progress()).toEqual({ idx: 0, total: 4 })
  })

  it('clamps the autoplay prefix so a sibling that fully contains the line never skips the whole quiz', () => {
    // A dominated sibling whose steps extend lineB: common prefix = all 4 of
    // lineB's steps. The walk must still quiz at least the last step.
    const superset: Line = {
      id: 'SUPER',
      chapter_id: 'ch',
      dfs_index: 7,
      steps: [...lineB.steps, { card_id: 'c_extra', expected_san: 'Qe2' }],
    }
    const engine = WalkEngine.quiz(lineB, sharedCards, {
      dominatedSiblings: [superset],
    })

    // First 3 steps autoplay…
    for (let i = 0; i < 3; i++) {
      expect(engine.current().kind).toBe('autoplay')
      engine.advance()
    }
    // …but the final step is a real quiz, so the outcome reflects recall.
    const last = engine.current()
    expect(last.kind).toBe('quiz')
    if (last.kind === 'quiz') {
      expect(last.card_id).toBe('c3_B')
    }
    const result = engine.submit('c3')
    expect(result.status).toBe('resolved')
    engine.advance()
    expect(engine.current().kind).toBe('done')
    expect(engine.quizzedCount()).toBe(1)
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })

  it('does not autoplay when no sibling shares any prefix (empty list or fully divergent siblings)', () => {
    // No siblings at all.
    const engine1 = WalkEngine.quiz(lineB, sharedCards)
    expect(engine1.current().kind).toBe('quiz')

    // A sibling that diverges from the very first step.
    const divergent: Line = {
      id: 'D',
      chapter_id: 'ch',
      dfs_index: 99,
      steps: [
        { card_id: 'c0_other', expected_san: 'a4' },
        { card_id: 'c1_other', expected_san: 'b3' },
      ],
    }
    const engine2 = WalkEngine.quiz(lineB, sharedCards, {
      dominatedSiblings: [divergent],
    })
    expect(engine2.current().kind).toBe('quiz')
  })

  it('line outcome ignores the autoplay prefix and reports pass_all_first when divergent steps are answered first-try', () => {
    const engine = WalkEngine.quiz(lineB, sharedCards, {
      dominatedSiblings: [lineA],
    })

    // Walk through the 2 autoplay prefix steps without submitting.
    expect(engine.current().kind).toBe('autoplay')
    engine.advance()
    expect(engine.current().kind).toBe('autoplay')
    engine.advance()

    // Quiz step 2: answer correctly first-try.
    expect(engine.current().kind).toBe('quiz')
    expect(engine.submit('d4').status).toBe('resolved')
    engine.advance()

    // Quiz step 3: answer correctly first-try.
    expect(engine.current().kind).toBe('quiz')
    expect(engine.submit('c3').status).toBe('resolved')
    engine.advance()

    expect(engine.current().kind).toBe('done')
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })

  it('teach mode walks every step as kind teach, closes pass_all_first, and the scheduler transitions a new state to Learning', () => {
    const engine = WalkEngine.teach(lineB, sharedCards)

    const visited: string[] = []
    while (true) {
      const cur = engine.current()
      if (cur.kind === 'done') break
      expect(cur.kind).toBe('teach')
      if (cur.kind === 'teach') {
        visited.push(cur.san)
      }
      engine.advance()
    }

    expect(visited).toEqual(lineB.steps.map((s) => s.expected_san))
    expect(engine.lineOutcome()).toBe('pass_all_first')

    // Caller closes the line with one scheduler.next call → Learning state.
    const scheduler = new LineScheduler()
    const after = scheduler.next(scheduler.initial(), engine.lineOutcome())
    expect(after.state).toBe('learning')
  })

  it('teach mode also respects the dominated-sibling autoplay prefix', () => {
    const engine = WalkEngine.teach(lineB, sharedCards, {
      dominatedSiblings: [lineA],
    })

    // First 2 steps autoplay (shared prefix), remaining 2 are teach.
    expect(engine.current().kind).toBe('autoplay')
    engine.advance()
    expect(engine.current().kind).toBe('autoplay')
    engine.advance()
    expect(engine.current().kind).toBe('teach')
    engine.advance()
    expect(engine.current().kind).toBe('teach')
    engine.advance()
    expect(engine.current().kind).toBe('done')
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })

  it('refresher mode emits autoplay for every step, exposes affectsScheduler === false, and rejects submit', () => {
    const engine = WalkEngine.refresher(lineB, sharedCards)

    expect(engine.affectsScheduler).toBe(false)

    const visited: string[] = []
    while (true) {
      const cur = engine.current()
      if (cur.kind === 'done') break
      expect(cur.kind).toBe('autoplay')
      if (cur.kind === 'autoplay') visited.push(cur.san)
      engine.advance()
    }
    expect(visited).toEqual(lineB.steps.map((s) => s.expected_san))

    // Even with a dominated prefix override, every step stays autoplay.
    const engine2 = WalkEngine.refresher(lineB, sharedCards, {
      dominatedSiblings: [lineA],
    })
    for (let i = 0; i < lineB.steps.length; i++) {
      expect(engine2.current().kind).toBe('autoplay')
      engine2.advance()
    }
    expect(engine2.current().kind).toBe('done')
  })

  it('refresher mode: quiz factories report affectsScheduler === true', () => {
    expect(WalkEngine.quiz(lineB, sharedCards).affectsScheduler).toBe(true)
    expect(WalkEngine.teach(lineB, sharedCards).affectsScheduler).toBe(true)
  })

  it('hint reveals the current card comment and floors lineOutcome to pass_with_retry', () => {
    const cardsWithHint: Card[] = sharedCards.map((c) =>
      c.id === 'c0' ? { ...c, comment: 'Open with the king pawn.' } : c,
    )
    const engine = WalkEngine.quiz(lineB, cardsWithHint)

    // Step 0: use hint. It reveals the comment on the current card.
    const revealed = engine.hint()
    expect(revealed.comment).toBe('Open with the king pawn.')

    // Now answer step 0 correctly on first attempt.
    expect(engine.submit('e4').status).toBe('resolved')
    engine.advance()

    // Answer remaining steps correctly on first attempt.
    expect(engine.submit('Nf3').status).toBe('resolved')
    engine.advance()
    expect(engine.submit('d4').status).toBe('resolved')
    engine.advance()
    expect(engine.submit('c3').status).toBe('resolved')
    engine.advance()

    expect(engine.current().kind).toBe('done')
    // No retries used, but hint floors the outcome to pass_with_retry.
    expect(engine.lineOutcome()).toBe('pass_with_retry')
  })

  it('hint + a later double-fail still produces fail (fail wins over the hint floor)', () => {
    const engine = WalkEngine.quiz(lineB, sharedCards)

    engine.hint()
    expect(engine.submit('e4').status).toBe('resolved')
    engine.advance()

    // Step 1: double-fail. Use two legal-but-wrong SANs.
    expect(engine.submit('a3').status).toBe('retry')
    expect(engine.submit('a4').status).toBe('resolved')
    engine.advance()

    // Drain remaining autoplay steps after failure.
    while (engine.current().kind !== 'done') engine.advance()

    expect(engine.lineOutcome()).toBe('fail')
  })

  it('hint returns an empty result when the current card has no comment and does NOT floor the outcome', () => {
    const engine = WalkEngine.quiz(lineB, sharedCards)
    const revealed = engine.hint()
    expect(revealed.comment).toBeUndefined()

    // The trainee got no information, so a clean walk still rates Good.
    for (const san of ['e4', 'Nf3', 'd4', 'c3']) {
      expect(engine.submit(san).status).toBe('resolved')
      engine.advance()
    }
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })

  it('retriesUsed() accumulates one retry per step across the whole line', () => {
    const engine = WalkEngine.quiz(lineB, sharedCards)

    // Step 0: retry then correct.
    expect(engine.submit('a3').status).toBe('retry')
    expect(engine.submit('e4').status).toBe('resolved')
    engine.advance()
    // Step 1: clean.
    expect(engine.submit('Nf3').status).toBe('resolved')
    engine.advance()
    // Step 2: retry then correct.
    expect(engine.submit('a3').status).toBe('retry')
    expect(engine.submit('d4').status).toBe('resolved')
    engine.advance()
    // Step 3: clean.
    expect(engine.submit('c3').status).toBe('resolved')
    engine.advance()

    expect(engine.current().kind).toBe('done')
    expect(engine.retriesUsed()).toBe(2)
    expect(engine.lineOutcome()).toBe('pass_with_retry')
  })

  it('hint is invalid outside quiz mode (teach / refresher throw)', () => {
    expect(() => WalkEngine.teach(lineB, sharedCards).hint()).toThrow()
    expect(() => WalkEngine.refresher(lineB, sharedCards).hint()).toThrow()
  })

  it('replay mode: currentStep at index 0 reports kind="replay" with san, fen, stepIndex=0 and totalSteps', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    const cur = engine.currentStep()
    expect(cur.kind).toBe('replay')
    if (cur.kind === 'replay') {
      expect(cur.san).toBe('e4')
      expect(cur.fen).toBe(sharedCards[0].fen_canonical)
      expect(cur.stepIndex).toBe(0)
      expect(cur.totalSteps).toBe(lineB.steps.length)
    }
    expect(engine.progress()).toEqual({ idx: 0, total: lineB.steps.length })
  })

  function replayIndex(engine: WalkEngine): number {
    const cur = engine.currentStep()
    if (cur.kind !== 'replay') throw new Error('expected replay step')
    return cur.stepIndex
  }

  it('replay mode: next() advances stepIndex and clamps at the last step', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    engine.next()
    expect(replayIndex(engine)).toBe(1)
    engine.next()
    engine.next()
    expect(replayIndex(engine)).toBe(3)
    engine.next() // overflow → clamp at totalSteps-1
    expect(replayIndex(engine)).toBe(3)
    engine.next()
    expect(replayIndex(engine)).toBe(3)
  })

  it('replay mode: prev() retreats stepIndex and clamps at 0', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    engine.next()
    engine.next()
    expect(replayIndex(engine)).toBe(2)
    engine.prev()
    expect(replayIndex(engine)).toBe(1)
    engine.prev()
    engine.prev() // underflow → clamp at 0
    expect(replayIndex(engine)).toBe(0)
  })

  it('replay mode: jumpTo clamps to [0, totalSteps-1]', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    engine.jumpTo(2)
    expect(replayIndex(engine)).toBe(2)
    engine.jumpTo(99)
    expect(replayIndex(engine)).toBe(3)
    engine.jumpTo(-5)
    expect(replayIndex(engine)).toBe(0)
  })

  it('replay mode: lineOutcome() throws (no outcome in replay)', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    expect(() => engine.lineOutcome()).toThrow()
  })

  it('replay mode: currentStep includes card comment when present', () => {
    const cardsWithComment: Card[] = sharedCards.map((c) =>
      c.id === 'c0' ? { ...c, comment: 'Intro comment' } : c,
    )
    const engine = WalkEngine.replay(lineB, cardsWithComment)
    const cur = engine.currentStep()
    if (cur.kind === 'replay') {
      expect(cur.comment).toBe('Intro comment')
    }
    engine.next()
    const cur1 = engine.currentStep()
    if (cur1.kind === 'replay') {
      expect(cur1.comment).toBeUndefined()
    }
  })

  it('replay mode: affectsScheduler is false (no DB writes from replay)', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    expect(engine.affectsScheduler).toBe(false)
  })

  it('replay mode: currentStep returns fen from the card at stepIndex', () => {
    const engine = WalkEngine.replay(lineB, sharedCards)
    engine.jumpTo(2)
    const cur = engine.currentStep()
    if (cur.kind === 'replay') {
      expect(cur.san).toBe('d4')
      expect(cur.fen).toBe(sharedCards[2].fen_canonical)
    }
    engine.jumpTo(3)
    const last = engine.currentStep()
    if (last.kind === 'replay') {
      expect(last.san).toBe('c3')
      expect(last.fen).toBe(sharedCards[4].fen_canonical) // c3_B
    }
  })

  it('picks the LONGEST matching prefix when multiple dominated siblings overlap with different prefix lengths', () => {
    // Sibling with only the very first step matching.
    const shorter: Line = {
      id: 'SHORT',
      chapter_id: 'ch',
      dfs_index: 5,
      steps: [
        { card_id: 'c0', expected_san: 'e4' },
        { card_id: 'cX', expected_san: 'Nc3' },
      ],
    }

    // Walking lineB with both shorter and lineA → lineA wins (2 steps).
    const engine = WalkEngine.quiz(lineB, sharedCards, {
      dominatedSiblings: [shorter, lineA],
    })

    expect(engine.current().kind).toBe('autoplay')
    engine.advance()
    expect(engine.current().kind).toBe('autoplay')
    engine.advance()
    expect(engine.current().kind).toBe('quiz')
  })
})

describe('WalkEngine — isFullyAutoplayed (stm opponent tails)', () => {
  function fenAt(moves: string[]): string {
    const ch = new Chess()
    for (const m of moves) ch.move(m)
    return canon(ch.fen())
  }

  // stm-chapter shape: opponent replies are real steps, so a line can END on
  // an opponent move (s1 has black to move while the user plays white).
  const cards: Card[] = [
    { id: 's0', chapter_id: 'ch', fen_canonical: fenAt([]), refutations: [] },
    {
      id: 's1',
      chapter_id: 'ch',
      fen_canonical: fenAt(['e4']),
      refutations: [],
    },
    {
      id: 's2',
      chapter_id: 'ch',
      fen_canonical: fenAt(['e4', 'e5']),
      refutations: [],
    },
  ]

  const mastered: Line = {
    id: 'M',
    chapter_id: 'ch',
    dfs_index: 0,
    steps: [{ card_id: 's0', expected_san: 'e4' }],
  }

  // The bug shape: the dominated prefix covers every user step and the tail
  // is opponent-only, so nothing in the walk needs trainee input.
  const opponentTail: Line = {
    id: 'T',
    chapter_id: 'ch',
    dfs_index: 1,
    steps: [
      { card_id: 's0', expected_san: 'e4' },
      { card_id: 's1', expected_san: 'e5' },
    ],
  }

  it('flags a quiz walk whose dominated prefix + opponent tail cover the whole line', () => {
    const engine = WalkEngine.quiz(opponentTail, cards, {
      dominatedSiblings: [mastered],
    })
    expect(engine.isFullyAutoplayed).toBe(true)

    // And indeed the walk runs to done without a single quiz prompt — the
    // outcome would self-grade pass_all_first if a caller persisted it.
    while (engine.current().kind === 'autoplay') engine.advance()
    expect(engine.current().kind).toBe('done')
    expect(engine.quizzedCount()).toBe(0)
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })

  it('flags a teach walk of the same shape', () => {
    const engine = WalkEngine.teach(opponentTail, cards, {
      dominatedSiblings: [mastered],
    })
    expect(engine.isFullyAutoplayed).toBe(true)
  })

  it('is false without a dominated sibling — the user step is quizzed', () => {
    const engine = WalkEngine.quiz(opponentTail, cards)
    expect(engine.isFullyAutoplayed).toBe(false)
    expect(engine.current().kind).toBe('quiz')
  })

  it('is false when the prefix clamp leaves a user step interactive (one-sided lines)', () => {
    // Both steps are the user's (white to move on both cards); even a sibling
    // that fully contains the line clamps to len-1, keeping a real quiz step.
    const userOnly: Line = {
      id: 'U',
      chapter_id: 'ch',
      dfs_index: 2,
      steps: [
        { card_id: 's0', expected_san: 'e4' },
        { card_id: 's2', expected_san: 'Nf3' },
      ],
    }
    const superset: Line = {
      id: 'S',
      chapter_id: 'ch',
      dfs_index: 3,
      steps: [...userOnly.steps, { card_id: 's_extra', expected_san: 'Nc6' }],
    }
    const engine = WalkEngine.quiz(userOnly, cards, {
      dominatedSiblings: [superset],
    })
    expect(engine.isFullyAutoplayed).toBe(false)
  })
})

// Game-comment shapes describe the starting position — the card the first
// teach/quiz step is built from.
const SHAPES_PGN = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

{[%cal Gg1f3][%csl Yd4]} 1. Nf3 {desarrolla} Nc6 2. Bc4 *
`

function buildShapesIngest() {
  const { lines, cards } = new PgnIngestor().ingest(SHAPES_PGN)
  return { line: lines[0], cards }
}

describe('WalkEngine — author shapes visibility', () => {
  it('teach steps expose the card shapes', () => {
    const { line, cards } = buildShapesIngest()
    const engine = WalkEngine.teach(line, cards)

    const step = engine.current()
    expect(step.kind).toBe('teach')
    if (step.kind === 'teach') {
      expect(step.shapes).toEqual([
        { brush: 'green', orig: 'g1', dest: 'f3' },
        { brush: 'yellow', orig: 'd4' },
      ])
    }
  })
})

describe('WalkEngine — hint reveals shapes', () => {
  it('quiz steps do not carry shapes before answering', () => {
    const { line, cards } = buildShapesIngest()
    const engine = WalkEngine.quiz(line, cards)

    const step = engine.current()
    expect(step.kind).toBe('quiz')
    expect('shapes' in step && step.shapes).toBeFalsy()
  })

  it('hint returns the card shapes and caps the outcome', () => {
    const { line, cards } = buildShapesIngest()
    const engine = WalkEngine.quiz(line, cards)

    const revealed = engine.hint()
    expect(revealed.shapes).toEqual([
      { brush: 'green', orig: 'g1', dest: 'f3' },
      { brush: 'yellow', orig: 'd4' },
    ])
    expect(revealed.comment).toBe('desarrolla')

    for (const s of line.steps) {
      engine.submit(s.expected_san)
      engine.advance()
    }
    expect(engine.lineOutcome()).toBe('pass_with_retry')
  })

  it('caps the outcome for a card with shapes but no comment', () => {
    const pgn = `[Event "P"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

{[%csl Yd4]} 1. Nf3 Nc6 2. Bc4 *
`
    const { lines, cards } = new PgnIngestor().ingest(pgn)
    const engine = WalkEngine.quiz(lines[0], cards)

    const revealed = engine.hint()
    expect(revealed.shapes).toEqual([{ brush: 'yellow', orig: 'd4' }])

    for (const s of lines[0].steps) {
      engine.submit(s.expected_san)
      engine.advance()
    }
    expect(engine.lineOutcome()).toBe('pass_with_retry')
  })

  it('still does not cap the outcome when the card has neither comment nor shapes', () => {
    const { lines, cards } = new PgnIngestor().ingest(LINEAR_PGN)
    const engine = WalkEngine.quiz(lines[0], cards)

    const revealed = engine.hint()
    expect(revealed).toEqual({})

    for (const s of lines[0].steps) {
      engine.submit(s.expected_san)
      engine.advance()
    }
    expect(engine.lineOutcome()).toBe('pass_all_first')
  })
})

describe('WalkEngine — replay shows shapes', () => {
  it('replay steps expose the card shapes position by position', () => {
    const { line, cards } = buildShapesIngest()
    const engine = WalkEngine.replay(line, cards)

    const first = engine.currentStep()
    expect(first.kind).toBe('replay')
    if (first.kind === 'replay') {
      expect(first.shapes).toEqual([
        { brush: 'green', orig: 'g1', dest: 'f3' },
        { brush: 'yellow', orig: 'd4' },
      ])
    }

    engine.next()
    const second = engine.currentStep()
    if (second.kind === 'replay') {
      expect(second.shapes).toBeUndefined()
    }
  })
})
