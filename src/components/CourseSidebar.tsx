import { useEffect, useMemo, useState } from 'react'
import { lineSidebarState } from '../lib/LineSidebarState.ts'
import { formatVariantLabel } from '../lib/VariantLabelFormatter.ts'
import { filterChapters, isFiltering } from '../lib/SidebarFilter.ts'
import type { StatusFilter } from '../lib/SidebarFilter.ts'
import { KebabMenu } from './KebabMenu.tsx'
import { ArchiveSection } from './ArchiveSection.tsx'
import type { SelectionScope } from '../lib/SelectionScope.ts'
import type {
  ArchivedLineEntry,
  PersistedLine,
  PersistedLineState,
} from '../lib/Repository.ts'

export interface CourseSidebarChapter {
  id: number
  name: string
  lines: PersistedLine[]
  lineStates: Map<number, PersistedLineState>
}

interface CourseSidebarProps {
  chapters: CourseSidebarChapter[]
  archivedEntries: ArchivedLineEntry[]
  selectedLineId: number | null
  now: Date
  onSelectLine: (lineId: number) => void
  onArchive: (lineId: number) => void
  onRestore: (lineId: number) => void
  onDelete: (lineId: number) => void
  isLineDisabled?: (
    lineId: number,
    lineState: PersistedLineState | null,
  ) => boolean
  // Multi-select wiring. `selection` is a mutable instance owned by the parent;
  // `selectionVersion` bumps on every mutation so React re-renders. `onMutate`
  // is called after the sidebar mutates the selection so the parent can bump
  // the version.
  selection: SelectionScope
  selectionVersion: number
  onMutate: () => void
}

function StateIcon({ status }: { status: 'new' | 'learning' | 'mastered' }) {
  if (status === 'mastered') {
    return (
      <span
        aria-label="mastered"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ok text-[10px] text-surface-0"
      >
        ✓
      </span>
    )
  }
  if (status === 'learning') {
    return (
      <span
        aria-label="learned"
        className="inline-block h-4 w-4 rounded-full border-2 border-accent"
      />
    )
  }
  return (
    <span
      aria-label="not learned"
      className="inline-block h-4 w-4 rounded-full border border-line-strong"
    />
  )
}

function DueDot() {
  return (
    <span
      aria-label="due"
      title="Review due"
      className="inline-block h-2 w-2 rounded-full bg-accent"
    />
  )
}

function chapterScopeKey(chapterId: number): string {
  return `chapter:${chapterId}`
}

const SINGLETONS_ACTIVE_SCOPE_KEY = 'singletons:active'

function singletonLineIds(chapters: CourseSidebarChapter[]): number[] {
  const ids: number[] = []
  for (const c of chapters) {
    if (c.lines.length === 1) ids.push(c.lines[0].id)
  }
  return ids
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
        checked
          ? 'border-accent bg-accent text-accent-contrast'
          : 'border-line-strong bg-surface-1 text-transparent'
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        <polyline points="3 8 7 12 13 4" />
      </svg>
    </span>
  )
}

function VariantItem({
  line,
  chapter,
  chapterLineCount,
  lineState,
  selected,
  now,
  disabled,
  onClick,
  onArchive,
  scopeKey,
  orderedIdsInScope,
  selection,
  onMutate,
}: {
  line: PersistedLine
  chapter: CourseSidebarChapter
  /** ORIGINAL line count of the chapter — labels must not change when the
      sidebar filter narrows the visible lines. */
  chapterLineCount: number
  lineState: PersistedLineState | null
  selected: boolean
  now: Date
  disabled: boolean
  onClick: () => void
  onArchive: (lineId: number) => void
  scopeKey: string
  orderedIdsInScope: number[]
  selection: SelectionScope
  onMutate: () => void
}) {
  const view = lineSidebarState(lineState, now)
  const label = formatVariantLabel({
    line,
    chapter: { name: chapter.name, lineCount: chapterLineCount },
  })
  const selectionActive = selection.count() > 0
  const inActiveScope = selection.getScope() === scopeKey
  const checked = selection.has(line.id)
  // Show the checkbox FIXED for every row of the active scope while there is
  // a selection. Other rows still get the hover-only checkbox so the user can
  // start a new selection elsewhere (which clears the previous one).
  const showFixedCheckbox = selectionActive && inActiveScope

  function handleRowClick(e: React.MouseEvent) {
    if (disabled) return
    if (selectionActive || e.shiftKey) {
      if (e.shiftKey) {
        selection.shiftRangeTo({ lineId: line.id, scopeKey, orderedIdsInScope })
      } else {
        selection.toggle({ lineId: line.id, scopeKey, orderedIdsInScope })
      }
      onMutate()
      return
    }
    onClick()
  }

  function handleCheckboxClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (disabled) return
    if (e.shiftKey) {
      selection.shiftRangeTo({ lineId: line.id, scopeKey, orderedIdsInScope })
    } else {
      selection.toggle({ lineId: line.id, scopeKey, orderedIdsInScope })
    }
    onMutate()
  }

  return (
    <div className="group flex items-center gap-1 rounded pr-1 has-[[aria-expanded='true']]:z-50">
      <button
        type="button"
        onClick={handleRowClick}
        disabled={disabled}
        aria-disabled={disabled}
        aria-current={selected ? 'true' : undefined}
        aria-label={label}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors duration-150 ${
          disabled
            ? 'cursor-not-allowed text-ink-faint'
            : selected
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-ink-muted hover:bg-surface-3'
        }`}
      >
        <span
          className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
          onClick={handleCheckboxClick}
          role="presentation"
        >
          {/* The StateIcon is hidden when the checkbox should be visible
              (fixed for active-scope rows, hover for everyone else). */}
          <span
            className={`${showFixedCheckbox ? 'hidden' : 'group-hover:hidden'}`}
          >
            <StateIcon status={view.status} />
          </span>
          <span
            className={`${
              showFixedCheckbox
                ? 'inline-flex'
                : 'hidden group-hover:inline-flex'
            }`}
          >
            <Checkbox checked={checked} />
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {view.isDue && <DueDot />}
      </button>
      <div className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[aria-expanded='true']]:opacity-100">
        <KebabMenu
          ariaLabel={`Actions on ${label}`}
          items={[{ label: 'Archive', onClick: () => onArchive(line.id) }]}
        />
      </div>
    </div>
  )
}

function ChapterSection({
  chapter,
  originalLineCount,
  selectedLineId,
  now,
  onSelectLine,
  onArchive,
  isLineDisabled,
  selection,
  onMutate,
  singletonIds,
}: {
  chapter: CourseSidebarChapter
  /** Unfiltered line count — keeps singleton/accordion shape and labels
      stable while the filter narrows `chapter.lines`. */
  originalLineCount: number
  selectedLineId: number | null
  now: Date
  onSelectLine: (lineId: number) => void
  onArchive: (lineId: number) => void
  isLineDisabled?: (
    lineId: number,
    lineState: PersistedLineState | null,
  ) => boolean
  selection: SelectionScope
  onMutate: () => void
  singletonIds: number[]
}) {
  const [expanded, setExpanded] = useState(true)
  const lines = [...chapter.lines].sort((a, b) => a.dfs_index - b.dfs_index)
  const chapterScope = chapterScopeKey(chapter.id)
  const orderedChapterIds = lines.map((l) => l.id)

  function disabledFor(line: PersistedLine): boolean {
    const ls = chapter.lineStates.get(line.id) ?? null
    return isLineDisabled ? isLineDisabled(line.id, ls) : false
  }

  // Single-line chapter: render as a direct variant, no accordion. Singletons
  // share a cross-chapter pool scope ('singletons:active') so they bulk together.
  if (originalLineCount === 1) {
    const line = lines[0]
    return (
      <VariantItem
        line={line}
        chapter={chapter}
        chapterLineCount={originalLineCount}
        lineState={chapter.lineStates.get(line.id) ?? null}
        selected={selectedLineId === line.id}
        now={now}
        disabled={disabledFor(line)}
        onClick={() => onSelectLine(line.id)}
        onArchive={onArchive}
        scopeKey={SINGLETONS_ACTIVE_SCOPE_KEY}
        orderedIdsInScope={singletonIds}
        selection={selection}
        onMutate={onMutate}
      />
    )
  }

  // Multi-line chapter: collapsible header with nested variants. The 100%
  // badge must reflect the WHOLE chapter, not the filter's visible subset —
  // a filter showing only learned lines would otherwise fake completion.
  const allLearned =
    lines.length === originalLineCount &&
    lines.every(
      (l) =>
        chapter.lineStates.get(l.id)?.state !== undefined &&
        chapter.lineStates.get(l.id)?.state !== 'new',
    )

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={`chapter-${chapter.id}-variants`}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
      >
        <span
          aria-hidden="true"
          className={`inline-block text-xs text-ink-faint transition-transform duration-200 ease-out ${
            expanded ? 'rotate-90' : ''
          }`}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1 truncate">{chapter.name}</span>
        {allLearned && (
          <span
            aria-label="chapter completed"
            className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[10px] font-semibold text-ok"
          >
            100%
          </span>
        )}
      </button>
      <div
        id={`chapter-${chapter.id}-variants`}
        className={`grid grid-cols-[minmax(0,1fr)] overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 min-w-0">
          <div className="ml-4 border-l border-line">
            {lines.map((line) => (
              <VariantItem
                key={line.id}
                line={line}
                chapter={chapter}
                chapterLineCount={originalLineCount}
                lineState={chapter.lineStates.get(line.id) ?? null}
                selected={selectedLineId === line.id}
                now={now}
                disabled={disabledFor(line)}
                onClick={() => onSelectLine(line.id)}
                onArchive={onArchive}
                scopeKey={chapterScope}
                orderedIdsInScope={orderedChapterIds}
                selection={selection}
                onMutate={onMutate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'due', label: 'Due' },
  { value: 'new', label: 'New' },
  { value: 'learning', label: 'Learning' },
  { value: 'mastered', label: 'Mastered' },
]

export function CourseSidebar({
  chapters,
  archivedEntries,
  selectedLineId,
  now,
  onSelectLine,
  onArchive,
  onRestore,
  onDelete,
  isLineDisabled,
  selection,
  selectionVersion: _selectionVersion,
  onMutate,
}: CourseSidebarProps) {
  // `_selectionVersion` is read implicitly via the prop change so React
  // re-renders the whole tree when the parent bumps it.
  const [query, setQuery] = useState('')
  const [statuses, setStatuses] = useState<ReadonlySet<StatusFilter>>(new Set())
  const criteria = useMemo(() => ({ query, statuses }), [query, statuses])
  const filtering = isFiltering(criteria)
  const visibleChapters = useMemo(
    () => filterChapters(chapters, criteria, now),
    [chapters, criteria, now],
  )

  // A live multi-selection over rows the filter is about to hide would let
  // the bulk bar act on invisible lines — clear it when the filter changes.
  useEffect(() => {
    if (!filtering) return
    if (selection.count() > 0) {
      selection.clear()
      onMutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria])

  const activeHiddenByFilter =
    filtering &&
    selectedLineId !== null &&
    chapters.some((c) => c.lines.some((l) => l.id === selectedLineId)) &&
    !visibleChapters.some((c) => c.lines.some((l) => l.id === selectedLineId))

  function toggleStatus(value: StatusFilter) {
    setStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const singletonIds = singletonLineIds(visibleChapters)
  return (
    <aside className="flex flex-1 flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-line bg-surface-1 p-2">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search line or chapter…"
            aria-label="Search the course"
            className="w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 pr-7 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
          />
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setStatuses(new Set())
              }}
              aria-label="Clear filter"
              title="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-ink-faint hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => toggleStatus(chip.value)}
              aria-pressed={statuses.has(chip.value)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-150 ${
                statuses.has(chip.value)
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-muted'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1 p-2">
        {activeHiddenByFilter && (
          <p className="rounded bg-surface-2 px-2 py-1.5 text-xs text-ink-faint">
            The active line is hidden by the filter.
          </p>
        )}
        {filtering && visibleChapters.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-ink-faint">
            No results for this filter.
          </p>
        )}
        {visibleChapters.map((chapter) => (
          <ChapterSection
            key={chapter.id}
            chapter={chapter}
            originalLineCount={
              chapters.find((c) => c.id === chapter.id)?.lines.length ??
              chapter.lines.length
            }
            selectedLineId={selectedLineId}
            now={now}
            onSelectLine={onSelectLine}
            onArchive={onArchive}
            isLineDisabled={isLineDisabled}
            selection={selection}
            onMutate={onMutate}
            singletonIds={singletonIds}
          />
        ))}
        <ArchiveSection
          entries={archivedEntries}
          selectedLineId={selectedLineId}
          onSelectLine={onSelectLine}
          onRestore={onRestore}
          onDelete={onDelete}
          selection={selection}
          onMutate={onMutate}
        />
      </div>
    </aside>
  )
}
