import type { Repository } from './Repository.ts'

export const BACKUP_VERSION = 3

export interface BackupSnapshot {
  version: number
  pgns: unknown[]
  chapters: unknown[]
  cards: unknown[]
  lines: unknown[]
  line_states: unknown[]
  review_events: unknown[]
  // Added in version 3 (weak-point tracking); absent in v2 backups.
  move_misses?: unknown[]
  puzzle_attempts?: unknown[]
}

export class BackupSerializer {
  async snapshot(repo: Repository): Promise<BackupSnapshot> {
    const dump = await repo.dumpAll()
    return { version: BACKUP_VERSION, ...dump }
  }

  async restore(repo: Repository, snap: BackupSnapshot): Promise<void> {
    // v2 backups predate weak-point tracking; they restore with those tables
    // empty. Anything else is unsupported.
    if (snap.version !== 2 && snap.version !== BACKUP_VERSION) {
      throw new Error(
        `Unsupported backup version ${snap.version}, expected ${BACKUP_VERSION}`,
      )
    }
    await repo.restoreAll({
      pgns: snap.pgns,
      chapters: snap.chapters,
      cards: snap.cards,
      lines: snap.lines,
      line_states: snap.line_states,
      review_events: snap.review_events,
      move_misses: snap.move_misses ?? [],
      puzzle_attempts: snap.puzzle_attempts ?? [],
    })
  }
}
