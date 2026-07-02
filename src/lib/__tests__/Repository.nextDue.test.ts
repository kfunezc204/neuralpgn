import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { LineScheduler } from '../LineScheduler.ts'
import { Repository } from '../Repository.ts'

// Two leaves → two lines in one chapter.
const BRANCHED_PGN = `[Event "Ch"]
[White "?"]
[Black "?"]
[Result "*"]

1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *
`

async function seedTwoLines() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  const result = new PgnIngestor().ingest(BRANCHED_PGN)
  const pgnId = await repo.savePgn({ name: 'Test', result })
  const [chapter] = await repo.getChaptersForPgn(pgnId)
  const lines = await repo.getLinesForChapter(chapter.id)
  return { repo, pgnId, lines }
}

describe('Repository — getPgnCounters.nextDueAt', () => {
  it('is null while every line is still new', async () => {
    const { repo, pgnId } = await seedTwoLines()

    const counters = await repo.getPgnCounters(pgnId)

    expect(counters.nextDueAt).toBeNull()
  })

  it('reports the earliest due among learned lines', async () => {
    const { repo, pgnId, lines } = await seedTwoLines()
    const sched = new LineScheduler()
    const t0 = new Date('2026-06-11T10:00:00Z')
    // Learn both lines; review one twice so its due lands later.
    let s0 = sched.initial(t0)
    s0 = sched.next(s0, 'pass_all_first', t0)
    await repo.saveLineState(lines[0].id, s0)
    let s1 = sched.initial(t0)
    s1 = sched.next(s1, 'pass_all_first', t0)
    s1 = sched.next(s1, 'pass_all_first', new Date('2026-06-12T10:00:00Z'))
    await repo.saveLineState(lines[1].id, s1)

    const counters = await repo.getPgnCounters(pgnId)

    const earliest = new Date(Math.min(s0.due.getTime(), s1.due.getTime()))
    expect(counters.nextDueAt).not.toBeNull()
    expect(counters.nextDueAt!.getTime()).toBe(earliest.getTime())
  })

  it('ignores archived lines when finding the next due', async () => {
    const { repo, pgnId, lines } = await seedTwoLines()
    const sched = new LineScheduler()
    const t0 = new Date('2026-06-11T10:00:00Z')
    let s0 = sched.initial(t0)
    s0 = sched.next(s0, 'pass_all_first', t0)
    await repo.saveLineState(lines[0].id, s0)

    await repo.archiveLine(lines[0].id)

    const counters = await repo.getPgnCounters(pgnId)
    expect(counters.nextDueAt).toBeNull()
  })
})
