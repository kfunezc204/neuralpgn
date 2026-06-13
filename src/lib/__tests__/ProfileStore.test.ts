import { describe, it, expect } from 'vitest'
import { ProfileStore } from '../ProfileStore.ts'
import { InMemoryFsAdapter } from './inMemoryFsAdapter.ts'

const STORE_PATH = 'profiles.json'

async function freshStore(): Promise<{
  store: ProfileStore
  fs: InMemoryFsAdapter
}> {
  const fs = new InMemoryFsAdapter()
  const store = new ProfileStore(fs, STORE_PATH)
  await store.load()
  return { store, fs }
}

describe('ProfileStore', () => {
  it('createProfile persists the name and assigns a non-empty id', async () => {
    const { store, fs } = await freshStore()

    const profile = await store.createProfile('Kevin')

    expect(profile.name).toBe('Kevin')
    expect(profile.id).toMatch(/.+/)

    // Persisted to disk in the JSON store
    const raw = await fs.readText(STORE_PATH)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.profiles).toHaveLength(1)
    expect(parsed.profiles[0]).toMatchObject({ id: profile.id, name: 'Kevin' })
  })

  it('first created profile becomes active automatically', async () => {
    const { store } = await freshStore()

    expect(store.getActiveProfile()).toBeNull()

    const profile = await store.createProfile('Kevin')

    expect(store.getActiveProfile()).toMatchObject({ id: profile.id, name: 'Kevin' })
  })

  it('listProfiles returns all profiles in creation order, second does not steal active', async () => {
    const { store } = await freshStore()

    const a = await store.createProfile('Kevin')
    const b = await store.createProfile('Alice')

    const all = store.listProfiles()
    expect(all.map((p) => p.id)).toEqual([a.id, b.id])
    expect(store.getActiveProfile()?.id).toBe(a.id)
  })

  it('setActiveProfile switches the active profile and persists it', async () => {
    const { store, fs } = await freshStore()
    const a = await store.createProfile('Kevin')
    const b = await store.createProfile('Alice')

    await store.setActiveProfile(b.id)

    expect(store.getActiveProfile()?.id).toBe(b.id)
    const parsed = JSON.parse((await fs.readText(STORE_PATH))!)
    expect(parsed.active_profile_id).toBe(b.id)
    expect(a.id).not.toBe(b.id)
  })

  it('setActiveProfile throws if the id is unknown', async () => {
    const { store } = await freshStore()
    await store.createProfile('Kevin')

    await expect(store.setActiveProfile('does-not-exist')).rejects.toThrow(
      /unknown profile/i,
    )
  })

  it('deleteProfile removes a non-active profile, keeps the active one, and persists', async () => {
    const { store, fs } = await freshStore()
    const a = await store.createProfile('Kevin')
    const b = await store.createProfile('VerifyTest')

    const removed = await store.deleteProfile(b.id)

    expect(removed.id).toBe(b.id)
    expect(removed.db_filename).toBe(b.db_filename)
    expect(store.listProfiles().map((p) => p.id)).toEqual([a.id])
    expect(store.getActiveProfile()?.id).toBe(a.id)
    const parsed = JSON.parse((await fs.readText(STORE_PATH))!)
    expect(parsed.profiles).toHaveLength(1)
  })

  it('deleting the active profile hands active to the first remaining, or null when none remain', async () => {
    const { store } = await freshStore()
    const a = await store.createProfile('Kevin')
    const b = await store.createProfile('Alice')

    await store.deleteProfile(a.id)
    expect(store.getActiveProfile()?.id).toBe(b.id)

    await store.deleteProfile(b.id)
    expect(store.getActiveProfile()).toBeNull()
    expect(store.listProfiles()).toEqual([])
  })

  it('deleteProfile throws for an unknown id', async () => {
    const { store } = await freshStore()
    await store.createProfile('Kevin')
    await expect(store.deleteProfile('nope')).rejects.toThrow(/unknown profile/i)
  })

  it('a fresh ProfileStore.load() over a populated file restores profiles and active id', async () => {
    const fs = new InMemoryFsAdapter()
    const first = new ProfileStore(fs, STORE_PATH)
    await first.load()
    const a = await first.createProfile('Kevin')
    const b = await first.createProfile('Alice')
    await first.setActiveProfile(b.id)

    const second = new ProfileStore(fs, STORE_PATH)
    await second.load()

    expect(second.listProfiles().map((p) => p.id)).toEqual([a.id, b.id])
    expect(second.getActiveProfile()?.id).toBe(b.id)
  })
})
