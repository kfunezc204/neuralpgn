export type ScopeKey = string

export interface ToggleArgs {
  lineId: number
  scopeKey: ScopeKey
  orderedIdsInScope: number[]
}

export interface ShiftRangeArgs {
  lineId: number
  scopeKey: ScopeKey
  orderedIdsInScope: number[]
}

export interface SelectAllArgs {
  scopeKey: ScopeKey
  orderedIdsInScope: number[]
}

export class SelectionScope {
  private scopeKey: ScopeKey | null = null
  private selectedIds = new Set<number>()
  private anchorLineId: number | null = null

  toggle({ lineId, scopeKey }: ToggleArgs): void {
    if (this.scopeKey !== scopeKey) {
      this.scopeKey = scopeKey
      this.selectedIds = new Set([lineId])
      this.anchorLineId = lineId
      return
    }
    if (this.selectedIds.has(lineId)) {
      this.selectedIds.delete(lineId)
    } else {
      this.selectedIds.add(lineId)
    }
    this.anchorLineId = lineId
  }

  shiftRangeTo({ lineId, scopeKey, orderedIdsInScope }: ShiftRangeArgs): void {
    if (this.scopeKey !== scopeKey || this.anchorLineId === null) {
      this.toggle({ lineId, scopeKey, orderedIdsInScope })
      return
    }
    const anchorIdx = orderedIdsInScope.indexOf(this.anchorLineId)
    const targetIdx = orderedIdsInScope.indexOf(lineId)
    if (anchorIdx === -1 || targetIdx === -1) {
      this.toggle({ lineId, scopeKey, orderedIdsInScope })
      return
    }
    const [lo, hi] =
      anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    for (let i = lo; i <= hi; i++) {
      this.selectedIds.add(orderedIdsInScope[i])
    }
  }

  selectAll({ scopeKey, orderedIdsInScope }: SelectAllArgs): void {
    if (orderedIdsInScope.length === 0) return
    this.scopeKey = scopeKey
    this.selectedIds = new Set(orderedIdsInScope)
    this.anchorLineId = orderedIdsInScope[orderedIdsInScope.length - 1]
  }

  selectNone(): void {
    this.clear()
  }

  clear(): void {
    this.scopeKey = null
    this.selectedIds = new Set()
    this.anchorLineId = null
  }

  count(): number {
    return this.selectedIds.size
  }

  getScope(): ScopeKey | null {
    return this.scopeKey
  }

  getIds(): number[] {
    return [...this.selectedIds]
  }

  has(lineId: number): boolean {
    return this.selectedIds.has(lineId)
  }
}
