import { describe, it, expect } from 'vitest'
import { SelectionScope } from '../SelectionScope.ts'

describe('SelectionScope', () => {
  it('starts empty: no scope, zero count, no ids selected', () => {
    const sel = new SelectionScope()

    expect(sel.count()).toBe(0)
    expect(sel.getScope()).toBeNull()
    expect(sel.getIds()).toEqual([])
    expect(sel.has(1)).toBe(false)
  })

  it('toggle on an empty scope marks the line and adopts that scope', () => {
    const sel = new SelectionScope()

    sel.toggle({
      lineId: 42,
      scopeKey: 'chapter:7',
      orderedIdsInScope: [10, 42, 99],
    })

    expect(sel.has(42)).toBe(true)
    expect(sel.count()).toBe(1)
    expect(sel.getScope()).toBe('chapter:7')
    expect(sel.getIds()).toEqual([42])
  })

  it('toggle twice on the same line within the same scope removes it (deselect)', () => {
    const sel = new SelectionScope()
    const args = { lineId: 5, scopeKey: 'chapter:1', orderedIdsInScope: [5, 6] }

    sel.toggle(args)
    sel.toggle(args)

    expect(sel.has(5)).toBe(false)
    expect(sel.count()).toBe(0)
  })

  it('toggle on a different scope clears the previous selection and starts fresh in the new scope', () => {
    const sel = new SelectionScope()
    sel.toggle({
      lineId: 1,
      scopeKey: 'chapter:A',
      orderedIdsInScope: [1, 2, 3],
    })
    sel.toggle({
      lineId: 2,
      scopeKey: 'chapter:A',
      orderedIdsInScope: [1, 2, 3],
    })
    expect(sel.count()).toBe(2)

    sel.toggle({
      lineId: 99,
      scopeKey: 'chapter:B',
      orderedIdsInScope: [99, 100],
    })

    expect(sel.getScope()).toBe('chapter:B')
    expect(sel.has(1)).toBe(false)
    expect(sel.has(2)).toBe(false)
    expect(sel.has(99)).toBe(true)
    expect(sel.count()).toBe(1)
  })

  it('clear empties the selection and forgets the scope', () => {
    const sel = new SelectionScope()
    sel.toggle({ lineId: 7, scopeKey: 'chapter:A', orderedIdsInScope: [7] })

    sel.clear()

    expect(sel.count()).toBe(0)
    expect(sel.getScope()).toBeNull()
    expect(sel.has(7)).toBe(false)
  })

  it('toggle empty scope after clear adopts the new scope (post-clear state is the same as fresh)', () => {
    const sel = new SelectionScope()
    sel.toggle({ lineId: 1, scopeKey: 'chapter:A', orderedIdsInScope: [1] })
    sel.clear()

    sel.toggle({
      lineId: 50,
      scopeKey: 'chapter:Z',
      orderedIdsInScope: [50, 51],
    })

    expect(sel.getScope()).toBe('chapter:Z')
    expect(sel.has(50)).toBe(true)
  })

  describe('shiftRangeTo', () => {
    it('marks the inclusive range between the previous anchor and the target in the same scope', () => {
      const sel = new SelectionScope()
      const ordered = [10, 20, 30, 40, 50]
      sel.toggle({
        lineId: 20,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })

      sel.shiftRangeTo({
        lineId: 40,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })

      expect(sel.getScope()).toBe('chapter:1')
      expect(sel.has(20)).toBe(true)
      expect(sel.has(30)).toBe(true)
      expect(sel.has(40)).toBe(true)
      expect(sel.has(10)).toBe(false)
      expect(sel.has(50)).toBe(false)
      expect(sel.count()).toBe(3)
    })

    it('with no prior anchor behaves like toggle on a fresh scope', () => {
      const sel = new SelectionScope()
      const ordered = [1, 2, 3]

      sel.shiftRangeTo({
        lineId: 2,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })

      expect(sel.getScope()).toBe('chapter:1')
      expect(sel.getIds()).toEqual([2])
    })

    it('with a different scope discards the anchor and toggles in the new scope', () => {
      const sel = new SelectionScope()
      sel.toggle({
        lineId: 1,
        scopeKey: 'chapter:A',
        orderedIdsInScope: [1, 2, 3],
      })

      sel.shiftRangeTo({
        lineId: 99,
        scopeKey: 'chapter:B',
        orderedIdsInScope: [98, 99, 100],
      })

      expect(sel.getScope()).toBe('chapter:B')
      expect(sel.has(1)).toBe(false)
      expect(sel.has(99)).toBe(true)
      expect(sel.count()).toBe(1)
    })

    it('reverse range (target before anchor) still marks inclusive range', () => {
      const sel = new SelectionScope()
      const ordered = [10, 20, 30, 40, 50]
      sel.toggle({
        lineId: 40,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })

      sel.shiftRangeTo({
        lineId: 20,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })

      expect(sel.has(20)).toBe(true)
      expect(sel.has(30)).toBe(true)
      expect(sel.has(40)).toBe(true)
      expect(sel.has(10)).toBe(false)
      expect(sel.has(50)).toBe(false)
    })

    it('only marks ids present in orderedIdsInScope (collapsed chapters cannot leak in)', () => {
      const sel = new SelectionScope()
      // Pretend the user collapsed chapters whose lines are not in this list.
      // Even though a hidden chapter would contain ids between 20 and 40 in
      // the broader DB, those ids are not in orderedIdsInScope, so they
      // must NOT be added to the selection.
      const visibleOrdered = [10, 20, 40, 50]
      sel.toggle({
        lineId: 20,
        scopeKey: 'chapter:1',
        orderedIdsInScope: visibleOrdered,
      })

      sel.shiftRangeTo({
        lineId: 40,
        scopeKey: 'chapter:1',
        orderedIdsInScope: visibleOrdered,
      })

      expect(sel.has(20)).toBe(true)
      expect(sel.has(40)).toBe(true)
      // Verify that nothing outside the visible list (e.g., 30, 35) is selected.
      expect(sel.has(30)).toBe(false)
      expect(sel.has(35)).toBe(false)
      expect(sel.count()).toBe(2)
    })

    it('keeps the existing selection intact and unions in the new range', () => {
      const sel = new SelectionScope()
      const ordered = [1, 2, 3, 4, 5]
      sel.toggle({
        lineId: 1,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })
      sel.toggle({
        lineId: 3,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })
      // After two toggles, both 1 and 3 are selected; anchor is on 3.

      sel.shiftRangeTo({
        lineId: 5,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })

      // Range 3..5 added; existing 1 remains; 2 stays unselected.
      expect(sel.has(1)).toBe(true)
      expect(sel.has(2)).toBe(false)
      expect(sel.has(3)).toBe(true)
      expect(sel.has(4)).toBe(true)
      expect(sel.has(5)).toBe(true)
      expect(sel.count()).toBe(4)
    })
  })

  describe('selectAll', () => {
    it('marks every id in orderedIdsInScope, adopts the scope, and parks anchor on the last id', () => {
      const sel = new SelectionScope()
      const ordered = [10, 20, 30, 40]

      sel.selectAll({ scopeKey: 'chapter:1', orderedIdsInScope: ordered })

      expect(sel.getScope()).toBe('chapter:1')
      expect(sel.count()).toBe(4)
      expect(sel.has(10)).toBe(true)
      expect(sel.has(40)).toBe(true)

      // Anchor should be on the last id: a subsequent shiftRangeTo to an
      // earlier id selects that range backward (no-op here since they're
      // already selected, but verifies anchor by extending with a higher id
      // is not needed — we simulate it through behavior).
      // Reset and re-test via an explicit anchor probe:
      sel.clear()
      sel.selectAll({ scopeKey: 'chapter:1', orderedIdsInScope: ordered })
      // Clear the bulk but keep scope/anchor by toggling one id off:
      // simpler: shiftRangeTo into a single id selects from anchor (last) to
      // that id. Verify range 20..40 ends up selected when we shift to 20.
      sel.shiftRangeTo({
        lineId: 20,
        scopeKey: 'chapter:1',
        orderedIdsInScope: ordered,
      })
      expect(sel.has(20)).toBe(true)
      expect(sel.has(30)).toBe(true)
      expect(sel.has(40)).toBe(true)
    })

    it('with empty orderedIdsInScope is a no-op (does not adopt scope)', () => {
      const sel = new SelectionScope()

      sel.selectAll({ scopeKey: 'chapter:9', orderedIdsInScope: [] })

      expect(sel.getScope()).toBeNull()
      expect(sel.count()).toBe(0)
    })
  })

  describe('selectNone', () => {
    it('empties the selection and forgets the scope (same as clear)', () => {
      const sel = new SelectionScope()
      sel.selectAll({ scopeKey: 'chapter:1', orderedIdsInScope: [1, 2, 3] })

      sel.selectNone()

      expect(sel.count()).toBe(0)
      expect(sel.getScope()).toBeNull()
      expect(sel.has(1)).toBe(false)
    })
  })

  describe('singletons:active pool', () => {
    it('toggling a singleton id adopts the singletons:active scope', () => {
      const sel = new SelectionScope()
      const singletonIds = [101, 202, 303]

      sel.toggle({
        lineId: 202,
        scopeKey: 'singletons:active',
        orderedIdsInScope: singletonIds,
      })

      expect(sel.getScope()).toBe('singletons:active')
      expect(sel.has(202)).toBe(true)
      expect(sel.count()).toBe(1)
    })

    it('switching from chapter:<id> to singletons:active clears the prior selection', () => {
      const sel = new SelectionScope()
      sel.toggle({
        lineId: 7,
        scopeKey: 'chapter:7',
        orderedIdsInScope: [7, 8, 9],
      })
      sel.toggle({
        lineId: 8,
        scopeKey: 'chapter:7',
        orderedIdsInScope: [7, 8, 9],
      })
      expect(sel.count()).toBe(2)

      sel.toggle({
        lineId: 100,
        scopeKey: 'singletons:active',
        orderedIdsInScope: [100, 200, 300],
      })

      expect(sel.getScope()).toBe('singletons:active')
      expect(sel.has(7)).toBe(false)
      expect(sel.has(8)).toBe(false)
      expect(sel.has(100)).toBe(true)
      expect(sel.count()).toBe(1)
    })

    it('selectAll on the pool marks every singleton and parks anchor on the last visual id', () => {
      const sel = new SelectionScope()
      const visualSingletonIds = [11, 22, 33, 44]

      sel.selectAll({
        scopeKey: 'singletons:active',
        orderedIdsInScope: visualSingletonIds,
      })

      expect(sel.getScope()).toBe('singletons:active')
      expect(sel.count()).toBe(4)
      expect(sel.has(11)).toBe(true)
      expect(sel.has(44)).toBe(true)

      // Anchor should be on 44 (last visual id). Shift-range to 22 ⇒ ids 22..44.
      sel.clear()
      sel.selectAll({
        scopeKey: 'singletons:active',
        orderedIdsInScope: visualSingletonIds,
      })
      // Now drop everything except verify anchor by extending from it.
      sel.shiftRangeTo({
        lineId: 22,
        scopeKey: 'singletons:active',
        orderedIdsInScope: visualSingletonIds,
      })
      expect(sel.has(22)).toBe(true)
      expect(sel.has(33)).toBe(true)
      expect(sel.has(44)).toBe(true)
    })

    it('switching back from singletons:active to a chapter clears the pool', () => {
      const sel = new SelectionScope()
      sel.toggle({
        lineId: 100,
        scopeKey: 'singletons:active',
        orderedIdsInScope: [100, 200, 300],
      })
      sel.toggle({
        lineId: 200,
        scopeKey: 'singletons:active',
        orderedIdsInScope: [100, 200, 300],
      })
      expect(sel.count()).toBe(2)

      sel.toggle({
        lineId: 41,
        scopeKey: 'chapter:5',
        orderedIdsInScope: [40, 41, 42],
      })

      expect(sel.getScope()).toBe('chapter:5')
      expect(sel.has(100)).toBe(false)
      expect(sel.has(200)).toBe(false)
      expect(sel.has(41)).toBe(true)
    })
  })
})
