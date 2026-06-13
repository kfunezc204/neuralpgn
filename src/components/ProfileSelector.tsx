import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { formatProfileSummary } from '../lib/ProfileSummary.ts'
import type { Profile } from '../lib/ProfileStore.ts'

interface Props {
  profiles: Profile[]
  onSelect: (id: string) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  /** Profile whose DB is open this session — not deletable until restart. */
  bootedProfileId?: string
}

export function ProfileSelector({
  profiles,
  onSelect,
  onCreate,
  onDelete,
  bootedProfileId,
}: Props) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null)
  const now = new Date()

  async function handleCreate() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim())
    } finally {
      setBusy(false)
      setName('')
    }
  }

  async function confirmDelete() {
    if (!onDelete || !pendingDelete) return
    const profile = pendingDelete
    setPendingDelete(null)
    setBusy(true)
    try {
      await onDelete(profile.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="view-enter mx-auto max-w-md p-8">
      <header className="flex items-center gap-3">
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          className="h-12 w-12 rounded-xl"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NeuralPGN</h1>
          <p className="text-sm text-ink-muted">¿Quién entrena hoy?</p>
        </div>
      </header>
      {profiles.length > 0 && (
        <ul className="mt-8 space-y-2">
          {profiles.map((p) => (
            <li key={p.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => void onSelect(p.id)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-line bg-surface-1 px-4 py-3 text-left transition-colors duration-150 hover:border-accent/40 hover:bg-surface-2"
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent"
                >
                  {p.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">
                    {p.name}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {formatProfileSummary(p.summary, now)}
                  </span>
                </span>
              </button>
              {onDelete && p.id !== bootedProfileId && (
                <button
                  type="button"
                  onClick={() => setPendingDelete(p)}
                  disabled={busy}
                  aria-label={`Eliminar perfil ${p.name}`}
                  title="Eliminar perfil"
                  className="rounded-lg border border-line px-3 text-ink-faint transition-colors duration-150 hover:border-danger/30 hover:bg-danger-soft hover:text-danger"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8 border-t border-line pt-6">
        <h2 className="text-sm font-medium text-ink-muted">
          Crear un perfil nuevo
        </h2>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
            }}
            placeholder="Nombre"
            className="flex-1 rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            disabled={busy}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover disabled:bg-surface-3 disabled:text-ink-faint"
          >
            Crear
          </button>
        </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          variant="danger"
          title={`Eliminar el perfil "${pendingDelete.name}"`}
          body="Se eliminará el perfil y todo su progreso. Esta acción no se puede deshacer."
          confirmLabel="Eliminar perfil"
          cancelLabel="Cancelar"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </main>
  )
}
