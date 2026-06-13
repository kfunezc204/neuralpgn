import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { LineScheduler } from '../LineScheduler.ts'
import { Repository } from '../Repository.ts'

const LINEAR_PGN = `[Event "Puzzle 1"]
[White "Tactics Pack"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

describe('Repository — line-as-atom schema', () => {
  it('persists chapters+cards+lines from an IngestResult and exposes them per chapter', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)

    const pgnId = await repo.savePgn({ name: 'Test PGN', result })
    expect(pgnId).toBeGreaterThan(0)

    const chapters = await repo.getChaptersForPgn(pgnId)
    expect(chapters).toHaveLength(1)
    expect(chapters[0].name).toBe('Tactics Pack')

    const cards = await repo.getCardsForChapter(chapters[0].id)
    expect(cards).toHaveLength(2)

    const lines = await repo.getLinesForChapter(chapters[0].id)
    expect(lines).toHaveLength(1)
    expect(lines[0].dfs_index).toBe(0)
    expect(lines[0].steps.map((s) => s.expected_san)).toEqual(['Nf3', 'Bc4'])
    // Every step.card_id must point to a real persisted card.
    const cardIds = new Set(cards.map((c) => c.id))
    for (const step of lines[0].steps) {
      expect(cardIds.has(step.card_id)).toBe(true)
    }
  })

  it('getDueLines returns a line whose state !== new and due <= now, and omits lines still in new state', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Test PGN', result })

    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const [line] = await repo.getLinesForChapter(chapter.id)

    // Initially: no line_state → getDueLines returns nothing.
    let due = await repo.getDueLines()
    expect(due).toEqual([])

    // Persist a learning-state line state with due in the past.
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')
    let state = sched.initial(t0)
    state = sched.next(state, 'pass_all_first', new Date(t0.getTime() + 86400_000))
    expect(state.state).not.toBe('new')
    // Force due to be definitely in the past for the assertion clock.
    state.due = new Date('2025-01-02T00:00:00Z')
    await repo.saveLineState(line.id, state)

    due = await repo.getDueLines(null, new Date('2025-01-05T00:00:00Z'))
    expect(due).toEqual([{ line_id: line.id, chapter_id: chapter.id }])

    // Per-chapter query also returns it.
    const dueChapter = await repo.getDueLines(chapter.id, new Date('2025-01-05T00:00:00Z'))
    expect(dueChapter).toEqual([{ line_id: line.id, chapter_id: chapter.id }])

    // If we reset to state=new, getDueLines omits it.
    const resetState = sched.initial(t0)
    resetState.due = new Date('2025-01-02T00:00:00Z')
    expect(resetState.state).toBe('new')
    await repo.saveLineState(line.id, resetState)
    due = await repo.getDueLines(null, new Date('2025-01-05T00:00:00Z'))
    expect(due).toEqual([])
  })

  it('getDominatedLinesForChapter returns lines whose state meets D10 (stability ≥ 21 AND consecutive_correct ≥ 3), with full steps[]', async () => {
    const TREE_PGN = `[Event "Branch"]
[White "Branch Chapter"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4 d5 2. c4) e5 2. Nf3 *
`
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TREE_PGN)
    const pgnId = await repo.savePgn({ name: 'Branch', result })

    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const lines = await repo.getLinesForChapter(chapter.id)
    expect(lines).toHaveLength(2)

    // No line_states yet → nothing dominated.
    let dominated = await repo.getDominatedLinesForChapter(chapter.id)
    expect(dominated).toEqual([])

    const [mainline, variation] = lines

    // Mark the mainline as dominated (stability ≥ 21, consecutive_correct ≥ 3).
    await repo.saveLineState(mainline.id, {
      stability: 30,
      difficulty: 5,
      due: new Date('2025-06-01T00:00:00Z'),
      state: 'review',
      reps: 5,
      lapses: 0,
      consecutive_correct: 3,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })

    // Variation is review-state but with stability and streak BELOW threshold.
    await repo.saveLineState(variation.id, {
      stability: 10,
      difficulty: 5,
      due: new Date('2025-06-01T00:00:00Z'),
      state: 'review',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })

    dominated = await repo.getDominatedLinesForChapter(chapter.id)
    expect(dominated).toHaveLength(1)
    expect(dominated[0].id).toBe(mainline.id)
    expect(dominated[0].steps.map((s) => s.expected_san)).toEqual(
      mainline.steps.map((s) => s.expected_san),
    )
  })

  it('getChapterCounters returns Z (total), Y (learned: state≠new), X (mastered: D10), N (due now & state≠new) for a chapter with mixed line states', async () => {
    const TREE_PGN = `[Event "Mixed"]
[White "Mixed Chapter"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4 d5) (1. c4 c5) (1. Nf3 Nf6) *
`
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TREE_PGN)
    const pgnId = await repo.savePgn({ name: 'Mixed', result })
    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const lines = await repo.getLinesForChapter(chapter.id)
    expect(lines).toHaveLength(4) // mainline + 3 sibling variations

    const now = new Date('2025-06-01T00:00:00Z')
    const past = new Date('2025-05-01T00:00:00Z') // due ≤ now
    const future = new Date('2025-07-01T00:00:00Z') // due > now

    // Line 0: stays 'new' → not learned, not mastered, not due.
    // Line 1: learning, due in the past → learned + due, not mastered.
    await repo.saveLineState(lines[1].id, {
      stability: 1,
      difficulty: 5,
      due: past,
      state: 'learning',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-04-01T00:00:00Z'),
    })
    // Line 2: review, due in the future, but stability/streak still below D10 → learned, not due, not mastered.
    await repo.saveLineState(lines[2].id, {
      stability: 10,
      difficulty: 5,
      due: future,
      state: 'review',
      reps: 2,
      lapses: 0,
      consecutive_correct: 2,
      last_review: new Date('2025-04-15T00:00:00Z'),
    })
    // Line 3: review, due past, mastery thresholds met → learned + due + mastered.
    await repo.saveLineState(lines[3].id, {
      stability: 30,
      difficulty: 5,
      due: past,
      state: 'review',
      reps: 5,
      lapses: 0,
      consecutive_correct: 5,
      last_review: new Date('2025-04-20T00:00:00Z'),
    })

    const counts = await repo.getChapterCounters(chapter.id, now)
    expect(counts).toEqual({ total: 4, learned: 3, mastered: 1, due: 2 })
  })

  it('getDueLinesAllChapters returns due, non-new lines from every chapter with their chapter_name', async () => {
    const repo = await freshRepo()

    // Two chapters in one PGN, with one line each.
    const TWO_CHAPTER_PGN = `[Event "G1"]
[White "Chapter Alpha"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 *

[Event "G2"]
[White "Chapter Beta"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 *
`
    const result = new PgnIngestor().ingest(TWO_CHAPTER_PGN)
    const pgnId = await repo.savePgn({ name: 'Multi', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    expect(chapters).toHaveLength(2)
    const alpha = chapters.find((c) => c.name === 'Chapter Alpha')!
    const beta = chapters.find((c) => c.name === 'Chapter Beta')!

    const [alphaLine] = await repo.getLinesForChapter(alpha.id)
    const [betaLine] = await repo.getLinesForChapter(beta.id)

    const past = new Date('2025-05-01T00:00:00Z')
    const future = new Date('2025-07-01T00:00:00Z')
    const now = new Date('2025-06-01T00:00:00Z')

    // Alpha line: review state, due in the past → should appear.
    await repo.saveLineState(alphaLine.id, {
      stability: 5,
      difficulty: 5,
      due: past,
      state: 'review',
      reps: 2,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-04-01T00:00:00Z'),
    })
    // Beta line: review state, due in the future → should NOT appear (not yet due).
    await repo.saveLineState(betaLine.id, {
      stability: 5,
      difficulty: 5,
      due: future,
      state: 'review',
      reps: 2,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-04-01T00:00:00Z'),
    })

    const due = await repo.getDueLinesAllChapters(now)
    expect(due).toHaveLength(1)
    expect(due[0]).toEqual({
      line_id: alphaLine.id,
      chapter_id: alpha.id,
      chapter_name: 'Chapter Alpha',
    })

    // Move beta into the past too: now both due.
    await repo.saveLineState(betaLine.id, {
      stability: 5,
      difficulty: 5,
      due: past,
      state: 'review',
      reps: 2,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-04-01T00:00:00Z'),
    })
    const allDue = await repo.getDueLinesAllChapters(now)
    expect(allDue.map((r) => r.chapter_name).sort()).toEqual([
      'Chapter Alpha',
      'Chapter Beta',
    ])
  })

  it('getDueLinesAllChapters skips lines whose state is still new even if due ≤ now', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Test', result })
    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const [line] = await repo.getLinesForChapter(chapter.id)

    // Save a 'new' state with due in the past — must be filtered out.
    const sched = new LineScheduler()
    const stillNew = sched.initial(new Date('2025-01-01T00:00:00Z'))
    stillNew.due = new Date('2025-01-02T00:00:00Z')
    expect(stillNew.state).toBe('new')
    await repo.saveLineState(line.id, stillNew)

    const due = await repo.getDueLinesAllChapters(new Date('2025-06-01T00:00:00Z'))
    expect(due).toEqual([])
  })

  it('getDominatedLinesForChapter scopes by profile_id', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Test', result })
    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const [line] = await repo.getLinesForChapter(chapter.id)

    // Profile A dominates the line; profile B does not.
    await repo.saveLineState(
      line.id,
      {
        stability: 50,
        difficulty: 5,
        due: new Date('2025-06-01T00:00:00Z'),
        state: 'review',
        reps: 5,
        lapses: 0,
        consecutive_correct: 5,
        last_review: new Date('2025-05-01T00:00:00Z'),
      },
      'profile_a',
    )

    const dominatedA = await repo.getDominatedLinesForChapter(
      chapter.id,
      'profile_a',
    )
    expect(dominatedA).toHaveLength(1)

    const dominatedB = await repo.getDominatedLinesForChapter(
      chapter.id,
      'profile_b',
    )
    expect(dominatedB).toEqual([])
  })
})

describe('Repository — PGN-level aggregations', () => {
  const TWO_CHAPTERS_PGN = `[Event "Lesson A"]
[White "Mate de Anastasia"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4) *

[Event "Lesson B"]
[White "Mate de Greco"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. c4 (1. Nf3) *
`

  it('getPgnCounters sums total/learned/mastered/due across all chapters of a PGN', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Two chapters', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    expect(chapters).toHaveLength(2)
    const [chapA, chapB] = chapters
    const linesA = await repo.getLinesForChapter(chapA.id)
    const linesB = await repo.getLinesForChapter(chapB.id)
    expect(linesA).toHaveLength(2)
    expect(linesB).toHaveLength(2)

    const now = new Date('2025-06-01T00:00:00Z')
    const past = new Date('2025-05-01T00:00:00Z')
    const future = new Date('2025-07-01T00:00:00Z')

    // linesA[0]: stays new (no state row).
    // linesA[1]: learning, due past → counted in learned + due.
    await repo.saveLineState(linesA[1].id, {
      stability: 1,
      difficulty: 5,
      due: past,
      state: 'learning',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-04-01T00:00:00Z'),
    })
    // linesB[0]: review, mastered (stability ≥ 21, consec ≥ 3), due in future → learned + mastered, NOT due.
    await repo.saveLineState(linesB[0].id, {
      stability: 30,
      difficulty: 5,
      due: future,
      state: 'review',
      reps: 5,
      lapses: 0,
      consecutive_correct: 3,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })
    // linesB[1]: review, due past, not mastered → learned + due, not mastered.
    await repo.saveLineState(linesB[1].id, {
      stability: 10,
      difficulty: 5,
      due: past,
      state: 'review',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })

    const counters = await repo.getPgnCounters(pgnId, now)
    expect(counters).toEqual({
      total: 4,
      learned: 3,
      mastered: 1,
      due: 2,
      // Earliest due among the three learned lines (both "past" rows).
      nextDueAt: past,
      // No review_events were logged in this seed — states were saved directly.
      learnedThisWeek: 0,
    })
  })

  it('getPgnCounters counts a line whose due equals now (boundary <= now), but excludes one with due strictly in the future', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Boundary check', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chapters[0].id)
    const linesB = await repo.getLinesForChapter(chapters[1].id)

    const now = new Date('2025-06-01T00:00:00Z')
    const exactlyNow = new Date('2025-06-01T00:00:00Z')
    const oneSecondLater = new Date('2025-06-01T00:00:01Z')

    // Line due exactly at now → should count.
    await repo.saveLineState(linesA[0].id, {
      stability: 5,
      difficulty: 5,
      due: exactlyNow,
      state: 'review',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })
    // Line due 1 second after now → should NOT count.
    await repo.saveLineState(linesB[0].id, {
      stability: 5,
      difficulty: 5,
      due: oneSecondLater,
      state: 'review',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })

    const counters = await repo.getPgnCounters(pgnId, now)
    expect(counters.due).toBe(1)
  })

  it('getNextLearnLineForPgn returns null when every line of the PGN has been learned (state != new)', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'All learned', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const allLines = [
      ...(await repo.getLinesForChapter(chapters[0].id)),
      ...(await repo.getLinesForChapter(chapters[1].id)),
    ]
    for (const l of allLines) {
      await repo.saveLineState(l.id, {
        stability: 5,
        difficulty: 5,
        due: new Date('2025-07-01T00:00:00Z'),
        state: 'review',
        reps: 1,
        lapses: 0,
        consecutive_correct: 1,
        last_review: new Date('2025-05-01T00:00:00Z'),
      })
    }

    const next = await repo.getNextLearnLineForPgn(pgnId)
    expect(next).toBeNull()
  })

  it('getNextLearnLineForPgn returns the first line whose state is new (or has no state row), skipping already-learned lines', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Partial', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chapters[0].id)

    // Mark the very first line of chapter A as already-learned. The next-to-learn
    // should therefore be linesA[1].
    await repo.saveLineState(linesA[0].id, {
      stability: 5,
      difficulty: 5,
      due: new Date('2025-07-01T00:00:00Z'),
      state: 'learning',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })

    const next = await repo.getNextLearnLineForPgn(pgnId)
    expect(next).toEqual({ line_id: linesA[1].id, chapter_id: chapters[0].id })
  })

  it('getNextLearnLineForPgn jumps to the next chapter (by chapter_id ASC) once the earlier chapter is fully learned', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Cross-chapter order', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chapters[0].id)
    const linesB = await repo.getLinesForChapter(chapters[1].id)

    // Both lines of chapter A learned → should skip to chapter B.
    for (const l of linesA) {
      await repo.saveLineState(l.id, {
        stability: 5,
        difficulty: 5,
        due: new Date('2025-07-01T00:00:00Z'),
        state: 'review',
        reps: 1,
        lapses: 0,
        consecutive_correct: 1,
        last_review: new Date('2025-05-01T00:00:00Z'),
      })
    }

    const next = await repo.getNextLearnLineForPgn(pgnId)
    // Should be the first line (lowest dfs_index) of the next chapter.
    const expectedLine = linesB.reduce((a, b) =>
      a.dfs_index < b.dfs_index ? a : b,
    )
    expect(next).toEqual({
      line_id: expectedLine.id,
      chapter_id: chapters[1].id,
    })
  })

  it('getNextDueLineForPgn returns null when no line has state!=new with due<=now', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'No due', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chapters[0].id)

    // line in 'new' with due past → not due (state==new excluded).
    // line in 'review' but due in future → not due.
    await repo.saveLineState(linesA[0].id, {
      stability: 5,
      difficulty: 5,
      due: new Date('2025-07-01T00:00:00Z'),
      state: 'review',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-05-01T00:00:00Z'),
    })

    const now = new Date('2025-06-01T00:00:00Z')
    const next = await repo.getNextDueLineForPgn(pgnId, now)
    expect(next).toBeNull()
  })

  it('getNextDueLineForPgn returns a line with state!=new AND due<=now, ignoring lines still in new state even if they had a due date', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'One due', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chapters[0].id)

    // linesA[1] is learning + due past → should be returned.
    await repo.saveLineState(linesA[1].id, {
      stability: 5,
      difficulty: 5,
      due: new Date('2025-05-01T00:00:00Z'),
      state: 'learning',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: new Date('2025-04-01T00:00:00Z'),
    })

    const now = new Date('2025-06-01T00:00:00Z')
    const next = await repo.getNextDueLineForPgn(pgnId, now)
    expect(next).toEqual({
      line_id: linesA[1].id,
      chapter_id: chapters[0].id,
    })
  })

  it('getNextDueLineForPgn picks the due line from the lowest chapter_id first, then lowest dfs_index within it', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Cross-chapter due order', result })
    const chapters = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chapters[0].id)
    const linesB = await repo.getLinesForChapter(chapters[1].id)

    const past = new Date('2025-05-01T00:00:00Z')

    // Multiple lines due across both chapters. Earliest chapter, lowest dfs wins.
    for (const l of [linesA[1], linesB[0], linesB[1]]) {
      await repo.saveLineState(l.id, {
        stability: 5,
        difficulty: 5,
        due: past,
        state: 'review',
        reps: 1,
        lapses: 0,
        consecutive_correct: 1,
        last_review: new Date('2025-04-01T00:00:00Z'),
      })
    }

    const now = new Date('2025-06-01T00:00:00Z')
    const next = await repo.getNextDueLineForPgn(pgnId, now)
    // linesA[1] is in chapter A (lower chapter_id) — wins over any line of chapter B.
    expect(next).toEqual({
      line_id: linesA[1].id,
      chapter_id: chapters[0].id,
    })
  })
})

describe('Repository — pgns.author', () => {
  const PGN_WITH_ANNOTATOR = `[Event "Lesson 1"]
[White "Mate de Anastasia"]
[Black "?"]
[Annotator "IM John Bartholomew"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 *
`

  it('persists IngestResult.author when saving a PGN and exposes it via listPgns', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(PGN_WITH_ANNOTATOR)

    await repo.savePgn({ name: 'Bartholomew Mates', result })

    const summaries = await repo.listPgns()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].author).toBe('IM John Bartholomew')
  })
})

describe('Repository — abandoned-walk safety', () => {
  it('leaves a lineState untouched if no saveLineState/logReviewEvent call follows the read (regression for the PRD invariant that abandoning mid-walk preserves prior SRS state)', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Abandon Test', result })

    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const [line] = await repo.getLinesForChapter(chapter.id)

    const priorReview = new Date('2025-05-01T00:00:00Z')
    await repo.saveLineState(line.id, {
      stability: 7,
      difficulty: 5,
      due: new Date('2025-05-08T00:00:00Z'),
      state: 'review',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      last_review: priorReview,
    })

    // Simulate the user opening this line mid-walk, playing nothing, then
    // navigating to another variant via the sidebar — only a read happens.
    const beforeAbandon = await repo.getLineState(line.id)
    expect(beforeAbandon?.last_review?.toISOString()).toBe(
      priorReview.toISOString(),
    )

    // No writes here. After the (simulated) navigation:
    const afterAbandon = await repo.getLineState(line.id)
    expect(afterAbandon).toEqual(beforeAbandon)
    expect(afterAbandon?.last_review?.toISOString()).toBe(
      priorReview.toISOString(),
    )
    expect(afterAbandon?.stability).toBe(7)
    expect(afterAbandon?.consecutive_correct).toBe(1)
  })
})

describe('Repository — learning_steps persistence', () => {
  it('round-trips learning_steps through saveLineState/getLineState', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    const pgnId = await repo.savePgn({ name: 'Steps Test', result })

    const [chapter] = await repo.getChaptersForPgn(pgnId)
    const [line] = await repo.getLinesForChapter(chapter.id)

    await repo.saveLineState(line.id, {
      stability: 1,
      difficulty: 5,
      due: new Date('2025-01-01T00:10:00Z'),
      state: 'learning',
      reps: 1,
      lapses: 0,
      consecutive_correct: 1,
      learning_steps: 1,
      last_review: new Date('2025-01-01T00:00:00Z'),
    })

    const state = await repo.getLineState(line.id)
    expect(state?.learning_steps).toBe(1)
  })

  it('adds the learning_steps column to a pre-existing v4 DB without nuking its rows', async () => {
    // Reproduce the exact upgrade path: a schema-v4 database written before
    // the column existed, with a learning-state row already in it.
    const adapter = openInMemoryAdapter()
    await adapter.execute(
      `CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    )
    await adapter.execute(
      `INSERT INTO schema_meta (key, value) VALUES ('version', '4')`,
    )
    await adapter.execute(`
      CREATE TABLE line_states (
        line_id INTEGER NOT NULL,
        profile_id TEXT NOT NULL DEFAULT 'default',
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        due TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('new','learning','review','relearning')),
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        consecutive_correct INTEGER NOT NULL DEFAULT 0,
        last_review TEXT,
        PRIMARY KEY (line_id, profile_id)
      )
    `)
    await adapter.execute(
      `INSERT INTO line_states (line_id, profile_id, stability, difficulty, due, state, reps, lapses, consecutive_correct, last_review)
       VALUES (1, 'default', 1, 5, '2025-01-01T00:10:00.000Z', 'learning', 1, 0, 1, '2025-01-01T00:00:00.000Z')`,
    )

    const repo = new Repository(adapter)
    await repo.migrate()
    // Migrating again must be a no-op (duplicate-column ALTER is swallowed).
    await repo.migrate()

    const state = await repo.getLineState(1)
    expect(state).not.toBeNull()
    expect(state?.learning_steps).toBe(0)
    expect(state?.consecutive_correct).toBe(1)
    expect(state?.state).toBe('learning')
  })
})
