import { invoke } from '@tauri-apps/api/core'
import type { FsAdapter } from './FsAdapter.ts'

export class TauriFsAdapter implements FsAdapter {
  async readText(path: string): Promise<string | null> {
    return (await invoke<string | null>('fs_read_text', { path })) ?? null
  }

  async writeText(path: string, content: string): Promise<void> {
    await invoke('fs_write_text', { path, content })
  }

  async remove(path: string): Promise<void> {
    await invoke('fs_remove', { path })
  }

  async listDir(dir: string): Promise<string[]> {
    return invoke<string[]>('fs_list_dir', { dir })
  }
}

export async function getAppDataDir(): Promise<string> {
  return invoke<string>('app_data_dir')
}
