import type { CourseTab } from '../lib/TabModeResolver.ts'

interface CourseTabsProps {
  activeTab: CourseTab
  dueCount: number
  onChange: (tab: CourseTab) => void
}

export function CourseTabs({ activeTab, dueCount, onChange }: CourseTabsProps) {
  const reviewDisabled = dueCount === 0
  return (
    <div role="tablist" aria-label="Course mode" className="flex gap-1">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'learn'}
        onClick={() => onChange('learn')}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
          activeTab === 'learn'
            ? 'bg-accent text-accent-contrast'
            : 'text-ink-muted hover:bg-surface-3'
        }`}
      >
        Learn
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'review'}
        aria-disabled={reviewDisabled}
        onClick={() => {
          if (reviewDisabled) return
          onChange('review')
        }}
        disabled={reviewDisabled}
        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${
          reviewDisabled
            ? 'cursor-not-allowed text-ink-faint'
            : activeTab === 'review'
              ? 'bg-accent text-accent-contrast'
              : 'text-ink-muted hover:bg-surface-3'
        }`}
      >
        Review
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-xs font-semibold tabular-nums ${
            reviewDisabled
              ? 'bg-surface-2 text-ink-faint'
              : activeTab === 'review'
                ? 'bg-accent-contrast/15 text-accent-contrast'
                : 'bg-accent-soft text-accent'
          }`}
        >
          {dueCount}
        </span>
      </button>
    </div>
  )
}
