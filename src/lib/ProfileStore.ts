import type { FsAdapter } from './FsAdapter.ts'

export interface ProfileSummarySnapshot {
  course_count: number
  due_count: number
  last_used_at: string
}

export interface Profile {
  id: string
  name: string
  db_filename: string
  created_at: string
  /**
   * Stats snapshot written at boot/switch so the selector can describe each
   * profile without opening its DB. May lag reality between sessions.
   */
  summary?: ProfileSummarySnapshot
}

interface StoreFile {
  active_profile_id: string | null
  profiles: Profile[]
}

const EMPTY: StoreFile = { active_profile_id: null, profiles: [] }

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export class ProfileStore {
  private data: StoreFile = EMPTY

  constructor(
    private readonly fs: FsAdapter,
    private readonly path: string,
  ) {}

  async load(): Promise<void> {
    const raw = await this.fs.readText(this.path)
    if (raw === null) {
      this.data = { active_profile_id: null, profiles: [] }
      return
    }
    this.data = JSON.parse(raw) as StoreFile
  }

  async createProfile(name: string): Promise<Profile> {
    const id = randomId()
    const profile: Profile = {
      id,
      name,
      db_filename: `neuralpgn.${id}.db`,
      created_at: new Date().toISOString(),
    }
    this.data.profiles.push(profile)
    if (this.data.active_profile_id === null) {
      this.data.active_profile_id = id
    }
    await this.persist()
    return profile
  }

  getActiveProfile(): Profile | null {
    if (this.data.active_profile_id === null) return null
    return (
      this.data.profiles.find((p) => p.id === this.data.active_profile_id) ??
      null
    )
  }

  listProfiles(): Profile[] {
    return [...this.data.profiles]
  }

  async setActiveProfile(id: string): Promise<void> {
    if (!this.data.profiles.some((p) => p.id === id)) {
      throw new Error(`unknown profile: ${id}`)
    }
    this.data.active_profile_id = id
    await this.persist()
  }

  /**
   * Removes a profile from the registry and returns it (so the caller can
   * clean up its data files). Deleting the active profile hands "active" to
   * the first remaining profile, or null when none remain.
   */
  async deleteProfile(id: string): Promise<Profile> {
    const idx = this.data.profiles.findIndex((p) => p.id === id)
    if (idx === -1) {
      throw new Error(`unknown profile: ${id}`)
    }
    const [removed] = this.data.profiles.splice(idx, 1)
    if (this.data.active_profile_id === id) {
      this.data.active_profile_id = this.data.profiles[0]?.id ?? null
    }
    await this.persist()
    return removed
  }

  async updateSummary(
    id: string,
    summary: ProfileSummarySnapshot,
  ): Promise<void> {
    const profile = this.data.profiles.find((p) => p.id === id)
    if (!profile) {
      throw new Error(`unknown profile: ${id}`)
    }
    profile.summary = summary
    await this.persist()
  }

  private async persist(): Promise<void> {
    await this.fs.writeText(this.path, JSON.stringify(this.data, null, 2))
  }
}
