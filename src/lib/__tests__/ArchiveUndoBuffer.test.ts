import { describe, it, expect } from 'vitest'
import { ArchiveUndoBuffer } from '../ArchiveUndoBuffer.ts'

describe('ArchiveUndoBuffer', () => {
  it('popIfFresh returns the pushed action while still inside the 5-second window (single = lineIds of length 1)', () => {
    const buf = new ArchiveUndoBuffer()
    const t0 = 1_000_000

    buf.push({ kind: 'archive', lineIds: [42], label: 'Variante 3: e4 e5' }, t0)

    expect(buf.popIfFresh(t0 + 4999)).toEqual({
      kind: 'archive',
      lineIds: [42],
      label: 'Variante 3: e4 e5',
    })
  })

  it('once the window expires, popIfFresh returns null and peek also reports the buffer as empty', () => {
    const buf = new ArchiveUndoBuffer()
    const t0 = 1_000_000

    buf.push({ kind: 'archive', lineIds: [7], label: 'Variante 1: d4 d5' }, t0)

    expect(buf.popIfFresh(t0 + 5001)).toBeNull()
    expect(buf.peek()).toBeNull()
  })

  it('pushing a second action inside the window replaces the first one (only the latest is undoable)', () => {
    const buf = new ArchiveUndoBuffer()
    const t0 = 1_000_000
    const A = {
      kind: 'archive' as const,
      lineIds: [1],
      label: 'Variante 1: e4',
    }
    const B = {
      kind: 'archive' as const,
      lineIds: [2],
      label: 'Variante 2: d4',
    }

    buf.push(A, t0)
    buf.push(B, t0 + 1000)

    expect(buf.peek()).toEqual(B)
  })

  it('clear() empties the buffer immediately (used after the caller consumes the undo)', () => {
    const buf = new ArchiveUndoBuffer()
    buf.push({ kind: 'restore', lineIds: [9], label: 'Variante 9' }, 1_000_000)

    buf.clear()

    expect(buf.peek()).toBeNull()
  })

  it('bulk action carries an array of N ids so undo can revert all of them atomically', () => {
    const buf = new ArchiveUndoBuffer()
    const t0 = 1_000_000

    buf.push(
      { kind: 'archive', lineIds: [10, 20, 30], label: '3 variantes' },
      t0,
    )

    const popped = buf.popIfFresh(t0 + 1)
    expect(popped).toEqual({
      kind: 'archive',
      lineIds: [10, 20, 30],
      label: '3 variantes',
    })
  })
})
