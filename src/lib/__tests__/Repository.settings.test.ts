import { describe, it, expect } from 'vitest'
import { openInMemoryAdapter } from './inMemoryAdapter.ts'
import { Repository } from '../Repository.ts'

async function freshRepo() {
  const repo = new Repository(openInMemoryAdapter())
  await repo.migrate()
  return repo
}

describe('Repository — settings', () => {
  it('returns null for a setting that was never written', async () => {
    const repo = await freshRepo()
    expect(await repo.getSetting('daily_new_limit')).toBeNull()
  })

  it('persists a written setting and reads it back', async () => {
    const repo = await freshRepo()
    await repo.setSetting('daily_new_limit', '30')
    expect(await repo.getSetting('daily_new_limit')).toBe('30')
  })

  it('overwrites an existing setting', async () => {
    const repo = await freshRepo()
    await repo.setSetting('daily_new_limit', '30')
    await repo.setSetting('daily_new_limit', '10')
    expect(await repo.getSetting('daily_new_limit')).toBe('10')
  })
})
