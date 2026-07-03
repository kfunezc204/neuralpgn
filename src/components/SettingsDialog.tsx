import { useEffect, useState } from 'react'
import { useRepository } from '../lib/RepositoryContext.tsx'
import {
  readDailyNewLimit,
  readSoundEnabled,
  writeDailyNewLimit,
  writeSoundEnabled,
} from '../lib/AppSettings.ts'
import { setSoundEnabled } from '../lib/FeedbackSounds.ts'

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const repo = useRepository()
  const [limit, setLimit] = useState<string>('')
  const [sound, setSound] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [value, soundValue] = await Promise.all([
        readDailyNewLimit(repo),
        readSoundEnabled(repo),
      ])
      if (cancelled) return
      setLimit(String(value))
      setSound(soundValue)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [repo])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    const n = Number(limit)
    if (!Number.isFinite(n) || n < 0) return
    await writeDailyNewLimit(repo, n)
    await writeSoundEnabled(repo, sound)
    // Apply immediately — the sound module caches the flag.
    setSoundEnabled(sound)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="view-enter relative w-full max-w-sm rounded-xl border border-line bg-surface-2 p-5 shadow-xl">
        <h2
          id="settings-dialog-title"
          className="text-base font-semibold text-ink"
        >
          Settings
        </h2>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink-muted">
            Daily limit of new lines
          </span>
          <input
            type="number"
            min={0}
            value={limit}
            disabled={!loaded}
            onChange={(e) => setLimit(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="mt-1 block text-xs text-ink-faint">
            Protects your coming days from a review avalanche. 0 = no limit.
          </span>
        </label>
        <label className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink-muted">
            Quiz sounds
          </span>
          <input
            type="checkbox"
            checked={sound}
            disabled={!loaded}
            onChange={(e) => setSound(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent,#d4a437)]"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!loaded}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover disabled:bg-surface-3 disabled:text-ink-faint"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
