import { describe, it, expect } from 'vitest'
import { PgnIngestor } from '../PgnIngestor.ts'

const LINEAR_PGN = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

describe('PgnIngestor — tracer bullet (line-as-atom model)', () => {
  it('parses a linear PGN into 1 chapter, deduped cards by FEN, and 1 Line whose steps[] mirror the mainline SANs', () => {
    const result = new PgnIngestor().ingest(LINEAR_PGN)

    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)

    const chapter = result.chapters[0]
    expect(chapter.name).toBe('Tactics Pack')
    expect(chapter.user_side).toBe('white')

    // Cards: one per unique FEN where the user has to move.
    // From the starting FEN, white plays Nf3, then after black's Nc6 white plays Bc4. Two user-positions.
    expect(result.cards).toHaveLength(2)
    const cardFens = new Set(result.cards.map((c) => c.fen_canonical))
    expect(cardFens.size).toBe(2)

    // Cards are read-only metadata: no acceptable_moves field.
    for (const card of result.cards) {
      expect(card).not.toHaveProperty('acceptable_moves')
      expect(card.chapter_id).toBe(chapter.id)
      expect(card.refutations).toEqual([])
    }

    // Lines: one root-to-leaf path (this PGN has no variations).
    expect(result.lines).toHaveLength(1)

    const line = result.lines[0]
    expect(line.chapter_id).toBe(chapter.id)
    expect(line.dfs_index).toBe(0)
    expect(line.steps).toHaveLength(2)

    // Each step references a card by id and dictates the expected_san for that step in this line.
    const stepSans = line.steps.map((s) => s.expected_san)
    expect(stepSans).toEqual(['Nf3', 'Bc4'])

    // Step.card_id must point to an actual emitted card.
    const cardIds = new Set(result.cards.map((c) => c.id))
    for (const step of line.steps) {
      expect(cardIds.has(step.card_id)).toBe(true)
    }
  })
})

describe('PgnIngestor — per-line intro comments', () => {
  const TWO_GAMES_WITH_INTROS = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

{Smothered mate pattern.} 1. Nf3 Nc6 2. Bc4 (2. Bb5) *

[Event "Puzzle 2"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

{Back-rank weakness.} 1. Qh5 *
`

  it("every line emitted from a game carries that game's intro comment, including sibling variation lines", () => {
    const result = new PgnIngestor().ingest(TWO_GAMES_WITH_INTROS)
    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)
    expect(result.lines).toHaveLength(3)

    // Game 1: mainline + the 2.Bb5 sibling, both with game 1's intro.
    const game1Lines = result.lines.filter(
      (l) => l.intro_comment === 'Smothered mate pattern.',
    )
    expect(game1Lines).toHaveLength(2)

    // Game 2: its own intro, not the chapter-level one.
    const game2Lines = result.lines.filter(
      (l) => l.intro_comment === 'Back-rank weakness.',
    )
    expect(game2Lines).toHaveLength(1)

    // Chapter intro keeps the first game's comment (existing behavior).
    expect(result.chapters[0].intro_comment).toBe('Smothered mate pattern.')
  })
})

describe('PgnIngestor — zero-step branches are not emitted as lines', () => {
  const INITIAL_POS_WHITE_ONLY_MOVE = `[Event "Repertoire"]
[White "Opening"]
[Black "?"]
[Result "*"]

1. e4 *
`

  it('skips a branch where the user side never moves instead of emitting an empty (instantly-passing) line', () => {
    // User plays black; the only move in the game is white's, so there is no
    // trainable step. An empty line would complete instantly and grade Good.
    const result = new PgnIngestor().ingest(INITIAL_POS_WHITE_ONLY_MOVE, {
      resolveStartingSide: () => 'black',
    })
    expect(result.lines).toHaveLength(0)
    expect(result.chapters[0].line_ids).toHaveLength(0)
  })
})

describe('PgnIngestor — chapter grouping by [White] tag', () => {
  const TWO_EVENTS_SAME_WHITE = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 *

[Event "Puzzle 2"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. d4 *
`

  it('collapses multiple [Event] with the same [White] tag into one chapter with one Line per event, distinct dfs_index', () => {
    const result = new PgnIngestor().ingest(TWO_EVENTS_SAME_WHITE)

    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)

    const chapter = result.chapters[0]
    expect(chapter.name).toBe('Tactics Pack')
    expect(chapter.line_ids).toHaveLength(2)

    expect(result.lines).toHaveLength(2)
    for (const line of result.lines) {
      expect(line.chapter_id).toBe(chapter.id)
    }

    const dfsIndices = result.lines.map((l) => l.dfs_index).sort()
    expect(dfsIndices).toEqual([0, 1])

    // Two distinct starting positions → two distinct cards.
    expect(result.cards).toHaveLength(2)
    const cardFens = new Set(result.cards.map((c) => c.fen_canonical))
    expect(cardFens.size).toBe(2)
  })
})

describe('PgnIngestor — DFS variations produce sibling Lines', () => {
  const TREE_PGN = `[Event "Tree"]
[White "Tree Test"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4 d5 2. c4) e5 2. Nf3 *
`

  it('emits one Line per DFS leaf, dedupes shared positions by canonical FEN, and shares card_ids on the common prefix', () => {
    const result = new PgnIngestor().ingest(TREE_PGN)

    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)
    const chapter = result.chapters[0]
    expect(chapter.user_side).toBe('white')

    // Two root-to-leaf paths: mainline (e4 e5 Nf3) and variation (d4 d5 c4).
    expect(result.lines).toHaveLength(2)

    const linesByDfs = [...result.lines].sort(
      (a, b) => a.dfs_index - b.dfs_index,
    )
    expect(linesByDfs.map((l) => l.dfs_index)).toEqual([0, 1])

    // Mainline emitted first.
    const mainline = linesByDfs[0]
    expect(mainline.steps.map((s) => s.expected_san)).toEqual(['e4', 'Nf3'])

    const variation = linesByDfs[1]
    expect(variation.steps.map((s) => s.expected_san)).toEqual(['d4', 'c4'])

    // Both lines start from the same canonical position → same first card_id.
    expect(mainline.steps[0].card_id).toBe(variation.steps[0].card_id)

    // After 1 ply the positions diverge → distinct card_ids at step index 1.
    expect(mainline.steps[1].card_id).not.toBe(variation.steps[1].card_id)

    // Card count: starting position (shared) + after 1.e4 e5 + after 1.d4 d5 = 3.
    expect(result.cards).toHaveLength(3)
  })
})

describe('PgnIngestor — $2/$4/$6 NAGs become Card.refutations', () => {
  const REFUTATION_PGN = `[Event "Fool"]
[White "Refutation Test"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. f3 $4 {fool} e5 2. g4 Qh4#) e5 *
`

  it('records a user-turn variation tagged $2/$4/$6 as a refutation on the parent card rather than emitting a sibling line', () => {
    const result = new PgnIngestor().ingest(REFUTATION_PGN)

    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)

    // Only the mainline produces a Line; the refutation is metadata on the card.
    expect(result.lines).toHaveLength(1)
    const mainline = result.lines[0]
    expect(mainline.steps.map((s) => s.expected_san)).toEqual(['e4'])

    // Cards: only the starting position (user-turn) — the refuted branch
    // never reaches the post-refutation position because it never becomes a Line.
    expect(result.cards).toHaveLength(1)
    const startCard = result.cards[0]

    expect(startCard.refutations).toHaveLength(1)
    const ref = startCard.refutations[0]
    expect(ref.san).toBe('f3')
    expect(ref.continuation).toEqual(['e5', 'g4', 'Qh4#'])
    expect(ref.comment).toBe('fool')

    // The refuted move's card_id appears on no Line.
    const refutedCardOnLine = mainline.steps.find(
      (s) => s.expected_san === 'f3',
    )
    expect(refutedCardOnLine).toBeUndefined()
  })

  it('all-black FENs in the same chapter resolve user_side to black', () => {
    // Position after 1.e4 with black to move.
    const BLACK_PGN = `[Event "X"]
[White "Black Side Chapter"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]
[SetUp "1"]

1... e5 *
`
    const result = new PgnIngestor().ingest(BLACK_PGN)
    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].user_side).toBe('black')
  })

  it('does not treat a non-user-turn variation as a refutation even if NAG $4 is present', () => {
    // Black is to move after 1.e4. A black variation tagged $4 is a "bad move by the opponent" —
    // since the user is white, this is not a refutation; it remains a sibling Line.
    const NON_USER_REF = `[Event "X"]
[White "Refutation Test 2"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 e5 (1... f6 $4 2. Qh5+) 2. Nf3 *
`
    const result = new PgnIngestor().ingest(NON_USER_REF)

    expect(result.warnings).toEqual([])
    expect(result.lines).toHaveLength(2) // mainline + opponent-variation sibling
    for (const card of result.cards) {
      expect(card.refutations).toEqual([])
    }
  })
})

describe('PgnIngestor — side detection rules', () => {
  it('mixed side-to-move across games within one chapter resolves to stm', () => {
    const MIXED_PGN = `[Event "G1"]
[White "Mixed Chapter"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 *

[Event "G2"]
[White "Mixed Chapter"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]
[SetUp "1"]

1... e5 *
`
    const result = new PgnIngestor().ingest(MIXED_PGN)
    expect(result.warnings).toEqual([])
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].user_side).toBe('stm')
  })

  it('chapter starting from the initial position with no resolver emits a side_unresolved warning and defaults to white', () => {
    const NO_FEN_PGN = `[Event "G1"]
[White "Initial Pos Chapter"]
[Black "?"]
[Result "*"]

1. e4 e5 2. Nf3 *
`
    const result = new PgnIngestor().ingest(NO_FEN_PGN)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].user_side).toBe('white')

    const warning = result.warnings.find((w) => w.code === 'side_unresolved')
    expect(warning).toBeDefined()
    expect(warning!.chapter_name).toBe('Initial Pos Chapter')
  })

  it('chapter starting from initial position with a resolver uses the resolver-chosen side without warning', () => {
    const NO_FEN_PGN = `[Event "G1"]
[White "Pick-A-Side Chapter"]
[Black "?"]
[Result "*"]

1. e4 e5 *
`
    const result = new PgnIngestor().ingest(NO_FEN_PGN, {
      resolveStartingSide: () => 'black',
    })
    expect(result.warnings).toEqual([])
    expect(result.chapters[0].user_side).toBe('black')
  })
})

describe('PgnIngestor — Annotator extraction', () => {
  it('extracts the [Annotator] tag from the first game and surfaces it as IngestResult.author', () => {
    const PGN_WITH_ANNOTATOR = `[Event "Lesson 1"]
[White "Mate de Anastasia"]
[Black "?"]
[Annotator "IM John Bartholomew"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 *
`
    const result = new PgnIngestor().ingest(PGN_WITH_ANNOTATOR)

    expect(result.warnings).toEqual([])
    expect(result.author).toBe('IM John Bartholomew')
  })

  it('leaves IngestResult.author undefined when no game carries an [Annotator] tag', () => {
    const PGN_WITHOUT_ANNOTATOR = `[Event "Lesson 1"]
[White "Mate de Anastasia"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 *
`
    const result = new PgnIngestor().ingest(PGN_WITHOUT_ANNOTATOR)

    expect(result.warnings).toEqual([])
    expect(result.author).toBeUndefined()
  })
})

describe('PgnIngestor — Lichess study chapter naming', () => {
  const LICHESS_STUDY_PGN = `[Event "Mi Estudio: Capítulo uno"]
[Result "*"]
[StudyName "Mi Estudio"]
[ChapterName "Capítulo uno"]
[Annotator "https://lichess.org/@/alguien"]

1. e4 e5 2. Nf3 *

[Event "Mi Estudio: Capítulo dos"]
[Result "*"]
[StudyName "Mi Estudio"]
[ChapterName "Capítulo dos"]
[Annotator "https://lichess.org/@/alguien"]

1. d4 d5 2. c4 *
`

  it('splits a Lichess study export into one chapter per game, named after ChapterName', () => {
    const result = new PgnIngestor().ingest(LICHESS_STUDY_PGN)

    expect(result.chapters.map((c) => c.name)).toEqual([
      'Capítulo uno',
      'Capítulo dos',
    ])
  })
})

describe('PgnIngestor — author shapes (%cal/%csl)', () => {
  it('attaches arrows and highlighted squares from the user move comment to its card', () => {
    const pgn = `[Event "Test"]
[White "Shapes Pack"]
[Result "*"]

1. e4 {[%cal Ge2e4,Rd8h4][%csl Yc6] controla el centro} e5 2. Nf3 *
`
    const result = new PgnIngestor().ingest(pgn, {
      resolveStartingSide: () => 'white',
    })

    expect(result.warnings).toEqual([])
    const cardE4 = result.cards.find((c) =>
      c.fen_canonical.startsWith(
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w',
      ),
    )
    expect(cardE4?.shapes).toEqual([
      { brush: 'green', orig: 'e2', dest: 'e4' },
      { brush: 'red', orig: 'd8', dest: 'h4' },
      { brush: 'yellow', orig: 'c6' },
    ])
    // Comment text stays clean alongside the extracted shapes.
    expect(cardE4?.comment).toBe('controla el centro')
  })

  it('drops annotations on opponent moves and emits no shapes field without annotations', () => {
    const pgn = `[Event "Test"]
[White "Shapes Pack"]
[Result "*"]

1. e4 e5 {[%cal Gg8f6] idea del rival} 2. Nf3 *
`
    const result = new PgnIngestor().ingest(pgn, {
      resolveStartingSide: () => 'white',
    })

    for (const card of result.cards) {
      expect(card.shapes).toBeUndefined()
    }
  })

  it('falls back to green for unknown color letters', () => {
    const pgn = `[Event "Test"]
[White "Shapes Pack"]
[Result "*"]

1. e4 {[%csl Zc6]} e5 *
`
    const result = new PgnIngestor().ingest(pgn, {
      resolveStartingSide: () => 'white',
    })

    expect(result.cards[0]?.shapes).toEqual([{ brush: 'green', orig: 'c6' }])
  })

  it('keeps the first shapes when FEN-deduped positions repeat across lines', () => {
    // Both branches pass through the same position after 1.e4 e5: the
    // mainline annotates 2.Nf3 with arrows; the variation annotates the same
    // position differently. First appearance wins, like card comments.
    const pgn = `[Event "Test"]
[White "Shapes Pack"]
[Result "*"]

1. e4 e5 2. Nf3 {[%cal Gg1f3]} Nc6 (2... d6 3. d4 {[%cal Gd2d4]}) 3. Bb5 *
`
    const result = new PgnIngestor().ingest(pgn, {
      resolveStartingSide: () => 'white',
    })

    const cardAfterE5 = result.cards.find((c) =>
      c.fen_canonical.startsWith(
        'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w',
      ),
    )
    expect(cardAfterE5?.shapes).toEqual([
      { brush: 'green', orig: 'g1', dest: 'f3' },
    ])
  })
})
