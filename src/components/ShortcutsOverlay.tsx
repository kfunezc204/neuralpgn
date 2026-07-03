import { useEffect, useState } from 'react'
import { SHORTCUT_GROUPS } from '../lib/KeyboardShortcuts.ts'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * "?" toggles a read-only overlay listing every registered shortcut. Mounted
 * once at the app root; never steals "?" while the user is typing in a field,
 * and being purely informational it cannot interrupt a walk in progress.
 */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-overlay-title"
      className="fixed inset-0 z-[950] flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div className="view-enter relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface-2 p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2
            id="shortcuts-overlay-title"
            className="text-base font-semibold text-ink"
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded px-1.5 text-ink-faint hover:text-ink"
          >
            ✕
          </button>
        </div>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.context} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {group.context}
            </h3>
            <dl className="mt-1.5 space-y-1">
              {group.shortcuts.map((s) => (
                <div
                  key={s.keys + s.description}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt>
                    <kbd className="rounded border border-line-strong bg-surface-1 px-1.5 py-0.5 font-mono text-xs text-ink">
                      {s.keys}
                    </kbd>
                  </dt>
                  <dd className="min-w-0 flex-1 text-right text-sm text-ink-muted">
                    {s.description}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
