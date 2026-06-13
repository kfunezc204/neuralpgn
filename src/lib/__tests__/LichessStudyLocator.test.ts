import { describe, it, expect } from 'vitest'
import { locateStudy } from '../LichessStudyLocator.ts'

describe('LichessStudyLocator', () => {
  it('extracts the study ID from a canonical study URL', () => {
    expect(locateStudy('https://lichess.org/study/AbCd1234')).toEqual({
      ok: true,
      studyId: 'AbCd1234',
    })
  })

  it('extracts the study ID from a chapter URL', () => {
    expect(locateStudy('https://lichess.org/study/AbCd1234/xYzW5678')).toEqual({
      ok: true,
      studyId: 'AbCd1234',
    })
  })

  it.each([
    'lichess.org/study/AbCd1234',
    'www.lichess.org/study/AbCd1234',
    'https://www.lichess.org/study/AbCd1234',
    'http://lichess.org/study/AbCd1234',
  ])('accepts the URL without scheme and/or with www: %s', (input) => {
    expect(locateStudy(input)).toEqual({ ok: true, studyId: 'AbCd1234' })
  })

  it('accepts the bare 8-character study ID', () => {
    expect(locateStudy('AbCd1234')).toEqual({ ok: true, studyId: 'AbCd1234' })
  })

  it('tolerates surrounding whitespace', () => {
    expect(locateStudy('  https://lichess.org/study/AbCd1234 \n')).toEqual({
      ok: true,
      studyId: 'AbCd1234',
    })
  })

  it.each([
    ['URL of another site', 'https://chess.com/study/AbCd1234'],
    ['lichess URL that is not a study', 'https://lichess.org/training/mix'],
    ['ID too short', 'AbCd123'],
    ['ID too long', 'AbCd12345'],
    ['arbitrary text', 'mi repertorio de la escocesa'],
    ['empty input', '   '],
  ])('rejects %s with a typed error', (_label, input) => {
    expect(locateStudy(input)).toEqual({ ok: false, error: 'invalid' })
  })
})
