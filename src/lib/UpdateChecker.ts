import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export interface AvailableUpdate {
  version: string
  /** Downloads, installs and relaunches the app. Resolves only on failure paths. */
  install: () => Promise<void>
}

/**
 * Ask the release endpoint whether a newer version exists. Any failure —
 * offline, dev build without updater artifacts, endpoint not yet populated —
 * reads as "no update": the check must never break app startup.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const update = await check()
    if (!update) return null
    return {
      version: update.version,
      install: async () => {
        await update.downloadAndInstall()
        // On Windows the installer exits the app itself; relaunch covers the
        // platforms where it doesn't.
        await relaunch()
      },
    }
  } catch {
    return null
  }
}
