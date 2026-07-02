import { describe, it, expect } from 'vitest'
import { filterChapters } from '../SidebarFilter.ts'
import type { FilterableChapter, FilterableLine } from '../SidebarFilter.ts'
import type { LineStateLike } from '../LineSidebarState.ts'

const NOW = new Date('2026-06-11T14:00:00')

let nextId = 1
function line(sans: string[], dfsIndex = 0): FilterableLine {
  return {
    id: nextId++,
    dfs_index: dfsIndex,
    steps: sans.map((s) => ({ expected_san: s })),
  }
}

function state(
  partial: Partial<LineStateLike> & { state: LineStateLike['state'] },
): LineStateLike {
  return {
    stability: 1,
    consecutive_correct: 0,
    due: new Date('2026-07-01T00:00:00'),
    ...partial,
  }
}

function chapter(
  name: string,
  lines: FilterableLine[],
  states: Map<number, LineStateLike> = new Map(),
): FilterableChapter {
  return { id: nextId++, name, lines, lineStates: states }
}

const NO_FILTER = { query: '', statuses: new Set<never>() }

describe('SidebarFilter — text', () => {
  it('matches chapter names accent- and case-insensitively, keeping all their lines', () => {
    const apertura = chapter('Apertura Española', [
      line(['e4', 'e5'], 0),
      line(['e4', 'c5'], 1),
    ])
    const gambito = chapter('Gambito de Dama', [line(['d4', 'd5'], 0)])

    const out = filterChapters(
      [apertura, gambito],
      {
        query: 'espanola',
        statuses: new Set(),
      },
      NOW,
    )

    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Apertura Española')
    expect(out[0].lines).toHaveLength(2)
  })

  it('matches individual variant labels by their SAN preview', () => {
    const ch = chapter('Siciliana', [
      line(['e4', 'c5', 'Nf3'], 0),
      line(['e4', 'c5', 'c3'], 1),
    ])

    const out = filterChapters([ch], { query: 'nf3', statuses: new Set() }, NOW)

    expect(out).toHaveLength(1)
    expect(out[0].lines).toHaveLength(1)
    expect(out[0].lines[0].steps[2].expected_san).toBe('Nf3')
  })

  it('drops chapters with no matches and returns [] when nothing matches', () => {
    const ch = chapter('Siciliana', [line(['e4', 'c5'], 0)])
    expect(
      filterChapters([ch], { query: 'caro-kann', statuses: new Set() }, NOW),
    ).toEqual([])
  })

  it('returns the input untouched when no filter is active', () => {
    const ch = chapter('Siciliana', [line(['e4', 'c5'], 0)])
    const out = filterChapters([ch], NO_FILTER, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].lines).toHaveLength(1)
  })
})

describe('SidebarFilter — status', () => {
  function statusFixture() {
    const lNew = line(['e4', 'e5'], 0)
    const lLearning = line(['e4', 'c5'], 1)
    const lMastered = line(['e4', 'e6'], 2)
    const lDue = line(['e4', 'c6'], 3)
    const states = new Map<number, LineStateLike>([
      [lLearning.id, state({ state: 'learning' })],
      [
        lMastered.id,
        state({ state: 'review', stability: 30, consecutive_correct: 3 }),
      ],
      [
        lDue.id,
        state({ state: 'review', due: new Date('2026-06-11T10:00:00') }),
      ],
    ])
    return {
      ch: chapter('Mixto', [lNew, lLearning, lMastered, lDue], states),
      lNew,
      lLearning,
      lMastered,
      lDue,
    }
  }

  it('filters by "new"', () => {
    const { ch, lNew } = statusFixture()
    const out = filterChapters(
      [ch],
      { query: '', statuses: new Set(['new'] as const) },
      NOW,
    )
    expect(out[0].lines.map((l) => l.id)).toEqual([lNew.id])
  })

  it('filters by "due"', () => {
    const { ch, lDue } = statusFixture()
    const out = filterChapters(
      [ch],
      { query: '', statuses: new Set(['due'] as const) },
      NOW,
    )
    expect(out[0].lines.map((l) => l.id)).toEqual([lDue.id])
  })

  it('filters by "mastered"', () => {
    const { ch, lMastered } = statusFixture()
    const out = filterChapters(
      [ch],
      { query: '', statuses: new Set(['mastered'] as const) },
      NOW,
    )
    expect(out[0].lines.map((l) => l.id)).toEqual([lMastered.id])
  })

  it('ORs multiple statuses and ANDs them with the text query', () => {
    const { ch, lNew, lDue } = statusFixture()
    const both = filterChapters(
      [ch],
      { query: '', statuses: new Set(['new', 'due'] as const) },
      NOW,
    )
    expect(both[0].lines.map((l) => l.id)).toEqual([lNew.id, lDue.id])

    // "c6" only matches the due line's label; 'new' status alone won't save lNew.
    const combined = filterChapters(
      [ch],
      { query: 'c6', statuses: new Set(['new', 'due'] as const) },
      NOW,
    )
    expect(combined[0].lines.map((l) => l.id)).toEqual([lDue.id])
  })
})
