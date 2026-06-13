import { describe, it, expect } from 'vitest'
import { InMemoryFsAdapter } from './inMemoryFsAdapter.ts'
import { ProfileStore } from '../ProfileStore.ts'

const PATH = 'appdata/profiles.json'

async function freshStore() {
  const fs = new InMemoryFsAdapter()
  const store = new ProfileStore(fs, PATH)
  await store.load()
  return { fs, store }
}

describe('ProfileStore — summary snapshot', () => {
  it('persists a summary and exposes it after a reload from disk', async () => {
    const { fs, store } = await freshStore()
    const profile = await store.createProfile('Kevin')

    await store.updateSummary(profile.id, {
      course_count: 3,
      due_count: 8,
      last_used_at: '2026-06-11T10:00:00.000Z',
    })

    const reloaded = new ProfileStore(fs, PATH)
    await reloaded.load()
    const [p] = reloaded.listProfiles()
    expect(p.summary).toEqual({
      course_count: 3,
      due_count: 8,
      last_used_at: '2026-06-11T10:00:00.000Z',
    })
  })

  it('a freshly created profile has no summary', async () => {
    const { store } = await freshStore()
    const profile = await store.createProfile('Nuevo')
    expect(profile.summary).toBeUndefined()
  })

  it('rejects a summary for an unknown profile', async () => {
    const { store } = await freshStore()
    await expect(
      store.updateSummary('nope', {
        course_count: 0,
        due_count: 0,
        last_used_at: '2026-06-11T10:00:00.000Z',
      }),
    ).rejects.toThrow()
  })
})
