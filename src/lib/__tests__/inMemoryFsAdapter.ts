import type { FsAdapter } from '../FsAdapter.ts'

export class InMemoryFsAdapter implements FsAdapter {
  private readonly files = new Map<string, string>()

  async readText(path: string): Promise<string | null> {
    return this.files.has(path) ? (this.files.get(path) as string) : null
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }

  async listDir(dir: string): Promise<string[]> {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    const names: string[] = []
    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length)
        if (rest && !rest.includes('/')) names.push(rest)
      }
    }
    return names.sort()
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files.entries())
  }
}
