import { describe, it, expect } from 'vitest'
import { formatVariantLabel } from '../VariantLabelFormatter.ts'

describe('VariantLabelFormatter', () => {
  it('returns the chapter name as the label when the chapter holds a single line', () => {
    const label = formatVariantLabel({
      line: { dfs_index: 0, steps: [{ expected_san: 'Nf3' }] },
      chapter: { name: 'Mate de Anastasia', lineCount: 1 },
    })

    expect(label).toBe('Mate de Anastasia')
  })

  it('returns "Line N: <first 6 sans> …" with an ellipsis when the chapter has multiple lines and the line is longer than the preview window', () => {
    const label = formatVariantLabel({
      line: {
        dfs_index: 4, // displayed as Line 5
        steps: [
          { expected_san: 'e4' },
          { expected_san: 'e5' },
          { expected_san: 'Nf3' },
          { expected_san: 'Nc6' },
          { expected_san: 'd4' },
          { expected_san: 'exd4' },
          { expected_san: 'Nxd4' }, // 7th — should not appear in preview
          { expected_san: 'Bb4' },
        ],
      },
      chapter: { name: 'Scotch Game', lineCount: 29 },
    })

    expect(label).toBe('Line 5: e4 e5 Nf3 Nc6 d4 exd4 …')
  })

  it('omits the ellipsis when the line has the preview length or fewer SANs', () => {
    const label = formatVariantLabel({
      line: {
        dfs_index: 0,
        steps: [
          { expected_san: 'e4' },
          { expected_san: 'e5' },
          { expected_san: 'Nf3' },
          { expected_san: 'Nc6' },
        ],
      },
      chapter: { name: 'Italian Game', lineCount: 4 },
    })

    expect(label).toBe('Line 1: e4 e5 Nf3 Nc6')
  })

  it('preserves complex SAN notation (castling, captures, checks, mates) verbatim in the preview', () => {
    const label = formatVariantLabel({
      line: {
        dfs_index: 2,
        steps: [
          { expected_san: 'O-O-O' },
          { expected_san: 'Nxe5+' },
          { expected_san: 'exd5#' },
        ],
      },
      chapter: { name: 'Tricky Tactics', lineCount: 7 },
    })

    expect(label).toBe('Line 3: O-O-O Nxe5+ exd5#')
  })
})
