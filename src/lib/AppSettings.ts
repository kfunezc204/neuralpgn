import type { Repository } from './Repository.ts'

export const DAILY_NEW_LIMIT_KEY = 'daily_new_limit'
export const DEFAULT_DAILY_NEW_LIMIT = 20

/** Per-profile daily new-lines limit; 0 means disabled. */
export async function readDailyNewLimit(repo: Repository): Promise<number> {
  const raw = await repo.getSetting(DAILY_NEW_LIMIT_KEY)
  if (raw === null) return DEFAULT_DAILY_NEW_LIMIT
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_NEW_LIMIT
}

export async function writeDailyNewLimit(
  repo: Repository,
  limit: number,
): Promise<void> {
  await repo.setSetting(
    DAILY_NEW_LIMIT_KEY,
    String(Math.max(0, Math.floor(limit))),
  )
}

export const GAMECHECK_USERNAME_KEY = 'gamecheck_username'

/** Player name used to identify the user's side in imported/synced games. */
export async function readGameCheckUsername(
  repo: Repository,
): Promise<string | null> {
  const raw = await repo.getSetting(GAMECHECK_USERNAME_KEY)
  return raw && raw.trim() !== '' ? raw : null
}

export async function writeGameCheckUsername(
  repo: Repository,
  username: string,
): Promise<void> {
  await repo.setSetting(GAMECHECK_USERNAME_KEY, username.trim())
}

export const LICHESS_LAST_SYNC_KEY = 'lichess_last_sync'

/** When the last successful Lichess games sync started; null before the first one. */
export async function readLichessLastSync(
  repo: Repository,
): Promise<Date | null> {
  const raw = await repo.getSetting(LICHESS_LAST_SYNC_KEY)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function writeLichessLastSync(
  repo: Repository,
  when: Date,
): Promise<void> {
  await repo.setSetting(LICHESS_LAST_SYNC_KEY, when.toISOString())
}

export const SOUND_ENABLED_KEY = 'sound_enabled'

/** Per-profile quiz-feedback sound toggle; defaults to on. */
export async function readSoundEnabled(repo: Repository): Promise<boolean> {
  const raw = await repo.getSetting(SOUND_ENABLED_KEY)
  return raw === null ? true : raw === 'true'
}

export async function writeSoundEnabled(
  repo: Repository,
  value: boolean,
): Promise<void> {
  await repo.setSetting(SOUND_ENABLED_KEY, value ? 'true' : 'false')
}
