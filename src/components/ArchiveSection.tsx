import { useState } from 'react'
import { KebabMenu } from './KebabMenu.tsx'
import { formatVariantLabel } from '../lib/VariantLabelFormatter.ts'
import type { SelectionScope } from '../lib/SelectionScope.ts'
import type { ArchivedLineEntry } from '../lib/Repository.ts'

const ARCHIVE_SCOPE_KEY = 'archive'

interface ArchiveSectionProps {
  entries: ArchivedLineEntry[]
  selectedLineId: number | null
  onSelectLine: (lineId: number) => void
  onRestore: (lineId: number) => void
  onDelete: (lineId: number) => void
  selection: SelectionScope
  onMutate: () => void
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

export function ArchiveSection({
  entries,
  selectedLineId,
  onSelectLine,
  onRestore,
  onDelete,
  selection,
  onMutate,
}: ArchiveSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) return null

  const orderedIdsInScope = entries.map((e) => e.line.id)
  const selectionActive = selection.count() > 0
  const inActiveScope = selection.getScope() === ARCHIVE_SCOPE_KEY
  const showFixedCheckbox = selectionActive && inActiveScope

  return (
    <div className="mt-4 border-t border-line pt-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls="archive-section-items"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-3"
      >
        <span
          aria-hidden="true"
          className={`inline-block text-xs text-ink-faint transition-transform duration-200 ease-out ${
            expanded ? 'rotate-90' : ''
          }`}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">📁 Archivo</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
          {entries.length}
        </span>
      </button>
      <div
        id="archive-section-items"
        className={`grid grid-cols-[minmax(0,1fr)] overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 min-w-0">
          <div className="ml-4 border-l border-line">
            {entries.map(({ line, chapter }) => {
              const label = formatVariantLabel({
                line,
                chapter: {
                  name: chapter.name,
                  lineCount: chapter.total_line_count,
                },
              })
              const selected = selectedLineId === line.id
              const checked = selection.has(line.id)

              function handleRowClick(e: React.MouseEvent) {
                if (selectionActive || e.shiftKey) {
                  if (e.shiftKey) {
                    selection.shiftRangeTo({
                      lineId: line.id,
                      scopeKey: ARCHIVE_SCOPE_KEY,
                      orderedIdsInScope,
                    })
                  } else {
                    selection.toggle({
                      lineId: line.id,
                      scopeKey: ARCHIVE_SCOPE_KEY,
                      orderedIdsInScope,
                    })
                  }
                  onMutate()
                  return
                }
                onSelectLine(line.id)
              }

              function handleCheckboxClick(e: React.MouseEvent) {
                e.stopPropagation()
                if (e.shiftKey) {
                  selection.shiftRangeTo({
                    lineId: line.id,
                    scopeKey: ARCHIVE_SCOPE_KEY,
                    orderedIdsInScope,
                  })
                } else {
                  selection.toggle({
                    lineId: line.id,
                    scopeKey: ARCHIVE_SCOPE_KEY,
                    orderedIdsInScope,
                  })
                }
                onMutate()
              }

              return (
                <div
                  key={line.id}
                  className="group flex items-start gap-1 rounded pr-1 has-[[aria-expanded='true']]:z-50"
                >
                  <button
                    type="button"
                    onClick={handleRowClick}
                    aria-current={selected ? 'true' : undefined}
                    aria-label={label}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors duration-150 ${
                      selected
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-ink-muted hover:bg-surface-3'
                    }`}
                  >
                    <span
                      className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center"
                      onClick={handleCheckboxClick}
                      role="presentation"
                    >
                      <span
                        className={
                          showFixedCheckbox
                            ? 'inline-flex'
                            : 'hidden group-hover:inline-flex'
                        }
                      >
                        <Checkbox checked={checked} />
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{label}</span>
                      <span className="truncate text-[11px] text-ink-faint">
                        ← {chapter.name}
                      </span>
                    </span>
                  </button>
                  <div className="mt-1.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-has-[[aria-expanded='true']]:opacity-100">
                    <KebabMenu
                      ariaLabel={`Acciones sobre ${label}`}
                      items={[
                        {
                          label: 'Restaurar',
                          onClick: () => onRestore(line.id),
                        },
                        {
                          label: 'Eliminar permanentemente',
                          onClick: () => onDelete(line.id),
                          danger: true,
                        },
                      ]}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export { ARCHIVE_SCOPE_KEY }
