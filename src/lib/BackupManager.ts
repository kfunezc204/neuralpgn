import type { FsAdapter } from './FsAdapter.ts'
import type { Repository } from './Repository.ts'
import { BackupSerializer, type BackupSnapshot } from './BackupSerializer.ts'

export interface BackupManagerOptions {
  dir: string
  keep: number
  now?: () => Date
}

function isoToFilename(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

const BACKUP_PREFIX = 'backup-'
const BACKUP_SUFFIX = '.json'

export class BackupManager {
  private readonly now: () => Date

  constructor(
    private readonly fs: FsAdapter,
    private readonly serializer: BackupSerializer,
    private readonly opts: BackupManagerOptions,
  ) {
    this.now = opts.now ?? (() => new Date())
  }

  async writeBackup(repo: Repository): Promise<string> {
    const snap = await this.serializer.snapshot(repo)
    const filename = `${BACKUP_PREFIX}${isoToFilename(this.now())}${BACKUP_SUFFIX}`
    await this.fs.writeText(
      `${this.opts.dir}/${filename}`,
      JSON.stringify(snap),
    )
    await this.rotate()
    return filename
  }

  async listBackups(): Promise<string[]> {
    const entries = await this.fs.listDir(this.opts.dir)
    return entries
      .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX))
      .sort()
      .reverse()
  }

  async restoreBackup(repo: Repository, filename: string): Promise<void> {
    const raw = await this.fs.readText(`${this.opts.dir}/${filename}`)
    if (raw === null) {
      throw new Error(`Backup file not found: ${filename}`)
    }
    const snap = JSON.parse(raw) as BackupSnapshot
    await this.serializer.restore(repo, snap)
  }

  private async rotate(): Promise<void> {
    const all = await this.listBackups()
    const obsolete = all.slice(this.opts.keep)
    for (const filename of obsolete) {
      await this.fs.remove(`${this.opts.dir}/${filename}`)
    }
  }
}
