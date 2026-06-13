export type ArchiveUndoActionKind = 'archive' | 'restore'

export interface ArchiveUndoAction {
  kind: ArchiveUndoActionKind
  lineIds: number[]
  label: string
}

const WINDOW_MS = 5000

export class ArchiveUndoBuffer {
  private action: ArchiveUndoAction | null = null
  private expiresAt = 0

  push(action: ArchiveUndoAction, now: number): void {
    this.action = action
    this.expiresAt = now + WINDOW_MS
  }

  popIfFresh(now: number): ArchiveUndoAction | null {
    if (!this.action) return null
    if (now < this.expiresAt) return this.action
    this.action = null
    this.expiresAt = 0
    return null
  }

  peek(): ArchiveUndoAction | null {
    return this.action
  }

  clear(): void {
    this.action = null
    this.expiresAt = 0
  }
}
