import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { PgnIngestor } from '../PgnIngestor.ts'
import { Repository } from '../Repository.ts'
import {
  computeProfileSummary,
  formatProfileSummary,
} from '../ProfileSummary.ts'

const NOW = new Date('2026-06-11T14:00:00')

const LINEAR_PGN = `[Event "Puzzle 1"]
[White "?"]
[Black "?"]
[Result "*"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]
[SetUp "1"]

1. Nf3 Nc6 2. Bc4 *
`

describe('ProfileSummary — compute', () => {
  it('captures course count, due count and the moment it was taken', async () => {
    const repo = new Repository(openInMemoryAdapter())
    await repo.migrate()
    const result = new PgnIngestor().ingest(LINEAR_PGN)
    await repo.savePgn({ name: 'Uno', result })

    const summary = await computeProfileSummary(repo, NOW)

    expect(summary.course_count).toBe(1)
    expect(summary.due_count).toBe(0)
    expect(summary.last_used_at).toBe(NOW.toISOString())
  })
})

describe('ProfileSummary — format', () => {
  it('describes a profile with courses, dues and recent use', () => {
    const text = formatProfileSummary(
      {
        course_count: 3,
        due_count: 8,
        last_used_at: '2026-06-11T09:00:00',
      },
      NOW,
    )
    expect(text).toBe('3 cursos · 8 repasos pendientes · usado hoy')
  })

  it('uses singulars and "ayer"', () => {
    const text = formatProfileSummary(
      {
        course_count: 1,
        due_count: 1,
        last_used_at: '2026-06-10T22:00:00',
      },
      NOW,
    )
    expect(text).toBe('1 curso · 1 repaso pendiente · usado ayer')
  })

  it('says "al día" when nothing is due and counts older use in days', () => {
    const text = formatProfileSummary(
      {
        course_count: 2,
        due_count: 0,
        last_used_at: '2026-06-06T10:00:00',
      },
      NOW,
    )
    expect(text).toBe('2 cursos · al día · usado hace 5 días')
  })

  it('describes a profile without snapshot as new', () => {
    expect(formatProfileSummary(undefined, NOW)).toBe('Perfil nuevo')
  })
})
