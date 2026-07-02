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

const TWO_CHAPTERS_PGN = `[Event "Branch A"]
[White "Chapter A"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. e4 (1. d4 d5) e5 2. Nf3 *

[Event "Branch B"]
[White "Chapter B"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
[SetUp "1"]

1. c4 *
`

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

async function seedSingleLine() {
  const repo = await freshRepo()
  const result = new PgnIngestor().ingest(LINEAR_PGN)
  const pgnId = await repo.savePgn({ name: 'Test PGN', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const [line] = await repo.getLinesForChapter(chapter.id)
  return { repo, pgnId, chapter, line }
}

describe('Repository — archive', () => {
  it('archived lines disappear from getLinesForChapter so the sidebar can hide them from their original chapter', async () => {
    const { repo, chapter, line } = await seedSingleLine()

    const before = await repo.getLinesForChapter(chapter.id)
    expect(before.map((l) => l.id)).toContain(line.id)

    await repo.archiveLine(line.id)

    const after = await repo.getLinesForChapter(chapter.id)
    expect(after.map((l) => l.id)).not.toContain(line.id)
  })

  it('getArchivedLinesForPgn lists archived lines with their chapter origin and orders them most-recently-archived first', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Two', result })

    const chapters = await repo.getChaptersForPgn(pgnId)
    expect(chapters).toHaveLength(2)
    const [chA, chB] = chapters
    const linesA = await repo.getLinesForChapter(chA.id)
    const linesB = await repo.getLinesForChapter(chB.id)
    expect(linesA.length).toBeGreaterThanOrEqual(2)
    expect(linesB).toHaveLength(1)

    // Empty when nothing archived.
    expect(await repo.getArchivedLinesForPgn(pgnId)).toEqual([])

    // Archive in order: linesA[0] first, then linesB[0], then linesA[1].
    const t1 = new Date('2025-01-01T00:00:00Z')
    const t2 = new Date('2025-01-02T00:00:00Z')
    const t3 = new Date('2025-01-03T00:00:00Z')
    await repo.archiveLine(linesA[0].id, t1)
    await repo.archiveLine(linesB[0].id, t2)
    await repo.archiveLine(linesA[1].id, t3)

    const archived = await repo.getArchivedLinesForPgn(pgnId)

    // Most-recent-first ordering.
    expect(archived.map((a) => a.line.id)).toEqual([
      linesA[1].id,
      linesB[0].id,
      linesA[0].id,
    ])
    // Each entry carries chapter origin info (id + name + total line count
    // including archived ones, so the label formatter can pick 1-line vs N-line format).
    expect(archived[0].chapter.id).toBe(chA.id)
    expect(archived[0].chapter.name).toBe(chA.name)
    expect(archived[0].chapter.total_line_count).toBe(linesA.length)
    expect(archived[1].chapter.id).toBe(chB.id)
    expect(archived[1].chapter.name).toBe(chB.name)
    expect(archived[1].chapter.total_line_count).toBe(linesB.length)
    // Line steps come through intact (so VariantLabelFormatter can label them).
    expect(archived[0].line.steps.length).toBeGreaterThan(0)
  })

  it('unarchiveLine brings the line back into getLinesForChapter so it returns to its original chapter in the sidebar', async () => {
    const { repo, chapter, line } = await seedSingleLine()

    await repo.archiveLine(line.id)
    expect(
      (await repo.getLinesForChapter(chapter.id)).map((l) => l.id),
    ).not.toContain(line.id)

    await repo.unarchiveLine(line.id)

    const after = await repo.getLinesForChapter(chapter.id)
    expect(after.map((l) => l.id)).toContain(line.id)
  })

  it('getPgnCounters excludes archived lines from total/learned/due so the home progress reflects active content only', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Two', result })
    const [chA, chB] = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chA.id)
    const linesB = await repo.getLinesForChapter(chB.id)
    const totalBefore = linesA.length + linesB.length

    // Mark one line as learned + due so it shows up in `learned` and `due`.
    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')
    let state = sched.initial(t0)
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 86400_000),
    )
    state.due = new Date('2025-01-02T00:00:00Z')
    await repo.saveLineState(linesA[0].id, state)

    const before = await repo.getPgnCounters(
      pgnId,
      new Date('2025-01-05T00:00:00Z'),
    )
    expect(before.total).toBe(totalBefore)
    expect(before.learned).toBe(1)
    expect(before.due).toBe(1)

    // Archive the learned line. Total and learned and due all drop by 1.
    await repo.archiveLine(linesA[0].id)

    const after = await repo.getPgnCounters(
      pgnId,
      new Date('2025-01-05T00:00:00Z'),
    )
    expect(after.total).toBe(totalBefore - 1)
    expect(after.learned).toBe(0)
    expect(after.due).toBe(0)
  })

  it('getNextLearnLineForPgn skips archived lines so the Aprender auto-pick goes to the next non-archived new line', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Two', result })
    const [chA, chB] = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chA.id)
    const linesB = await repo.getLinesForChapter(chB.id)
    expect(linesA.length).toBeGreaterThanOrEqual(2)

    // First call: returns the very first line (chA.id ASC → dfs_index ASC).
    const first = await repo.getNextLearnLineForPgn(pgnId)
    expect(first).not.toBeNull()
    const firstId = first!.line_id

    // Archive that one; next-learn should pick the next available line, not the archived one.
    await repo.archiveLine(firstId)
    const second = await repo.getNextLearnLineForPgn(pgnId)
    expect(second).not.toBeNull()
    expect(second!.line_id).not.toBe(firstId)

    // Archive every line; next-learn returns null.
    for (const l of [...linesA, ...linesB]) {
      await repo.archiveLine(l.id)
    }
    expect(await repo.getNextLearnLineForPgn(pgnId)).toBeNull()
  })

  it('getNextDueLineForPgn skips archived lines so the Repasar auto-pick lands on a non-archived due line', async () => {
    const { repo, pgnId, line } = await seedSingleLine()

    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')
    let state = sched.initial(t0)
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 86400_000),
    )
    state.due = new Date('2025-01-02T00:00:00Z')
    await repo.saveLineState(line.id, state)

    const now = new Date('2025-01-05T00:00:00Z')
    expect((await repo.getNextDueLineForPgn(pgnId, now))!.line_id).toBe(line.id)

    await repo.archiveLine(line.id)
    expect(await repo.getNextDueLineForPgn(pgnId, now)).toBeNull()
  })

  it('getDueLinesAllChapters excludes archived lines so the global "Repasar todo" queue ignores them', async () => {
    const { repo, line } = await seedSingleLine()

    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')
    let state = sched.initial(t0)
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 86400_000),
    )
    state.due = new Date('2025-01-02T00:00:00Z')
    await repo.saveLineState(line.id, state)

    const now = new Date('2025-01-05T00:00:00Z')
    const before = await repo.getDueLinesAllChapters(now)
    expect(before.map((r) => r.line_id)).toContain(line.id)

    await repo.archiveLine(line.id)

    const after = await repo.getDueLinesAllChapters(now)
    expect(after.map((r) => r.line_id)).not.toContain(line.id)
  })

  it('getDueLines excludes archived lines in both the per-chapter and the all-chapters form', async () => {
    const { repo, chapter, line } = await seedSingleLine()

    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')
    let state = sched.initial(t0)
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 86400_000),
    )
    state.due = new Date('2025-01-02T00:00:00Z')
    await repo.saveLineState(line.id, state)

    const now = new Date('2025-01-05T00:00:00Z')
    expect(
      (await repo.getDueLines(chapter.id, now)).map((r) => r.line_id),
    ).toContain(line.id)
    expect((await repo.getDueLines(null, now)).map((r) => r.line_id)).toContain(
      line.id,
    )

    await repo.archiveLine(line.id)

    expect(await repo.getDueLines(chapter.id, now)).toEqual([])
    expect(await repo.getDueLines(null, now)).toEqual([])
  })

  it('getChapterCounters excludes archived lines from total/learned/due/mastered', async () => {
    const repo = await freshRepo()
    const result = new PgnIngestor().ingest(TWO_CHAPTERS_PGN)
    const pgnId = await repo.savePgn({ name: 'Two', result })
    const [chA] = await repo.getChaptersForPgn(pgnId)
    const linesA = await repo.getLinesForChapter(chA.id)
    expect(linesA.length).toBeGreaterThanOrEqual(2)

    // Learned + due + mastered state on the first line.
    const sched = new LineScheduler()
    let state = sched.initial(new Date('2025-01-01T00:00:00Z'))
    state = sched.next(
      state,
      'pass_all_first',
      new Date('2025-01-02T00:00:00Z'),
    )
    state.due = new Date('2025-01-03T00:00:00Z')
    state.stability = 30
    state.consecutive_correct = 3
    await repo.saveLineState(linesA[0].id, state)

    const now = new Date('2025-01-05T00:00:00Z')
    const before = await repo.getChapterCounters(chA.id, now)
    expect(before).toEqual({
      total: linesA.length,
      learned: 1,
      mastered: 1,
      due: 1,
    })

    await repo.archiveLine(linesA[0].id)

    const after = await repo.getChapterCounters(chA.id, now)
    expect(after).toEqual({
      total: linesA.length - 1,
      learned: 0,
      mastered: 0,
      due: 0,
    })
  })

  it('getLineStatesForChapter excludes states of archived lines so the sidebar map mirrors the (filtered) lines list', async () => {
    const { repo, chapter, line } = await seedSingleLine()

    const sched = new LineScheduler()
    let state = sched.initial(new Date('2025-01-01T00:00:00Z'))
    state = sched.next(
      state,
      'pass_all_first',
      new Date('2025-01-02T00:00:00Z'),
    )
    await repo.saveLineState(line.id, state)

    const before = await repo.getLineStatesForChapter(chapter.id)
    expect(before.map((s) => s.line_id)).toContain(line.id)

    await repo.archiveLine(line.id)

    const after = await repo.getLineStatesForChapter(chapter.id)
    expect(after.map((s) => s.line_id)).not.toContain(line.id)
  })

  it('archiveLine preserves the existing LineState row untouched so restore can recover progress', async () => {
    const { repo, line } = await seedSingleLine()

    const sched = new LineScheduler()
    const t0 = new Date('2025-01-01T00:00:00Z')
    let state = sched.initial(t0)
    state = sched.next(
      state,
      'pass_all_first',
      new Date(t0.getTime() + 86400_000),
    )
    await repo.saveLineState(line.id, state)
    const before = await repo.getLineState(line.id)
    expect(before).not.toBeNull()

    await repo.archiveLine(line.id)

    const after = await repo.getLineState(line.id)
    expect(after).not.toBeNull()
    expect(after!.due.toISOString()).toBe(before!.due.toISOString())
    expect(after!.stability).toBe(before!.stability)
    expect(after!.state).toBe(before!.state)
    expect(after!.reps).toBe(before!.reps)
  })
})
