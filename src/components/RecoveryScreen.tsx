import { useState, type ChangeEvent } from 'react'
import type { BackupSnapshot } from '../lib/BackupSerializer.ts'

interface Props {
  error: string
  backups: string[]
  onRestore: (filename: string) => Promise<void>
  onImportManual: (snap: BackupSnapshot) => Promise<void>
  onRetry: () => void
}

function humanizeBackupName(filename: string): string {
  const m = filename.match(/^backup-(.+)\.json$/)
  if (!m) return filename
  return m[1]
}

export function RecoveryScreen({
  error,
  backups,
  onRestore,
  onImportManual,
  onRetry,
}: Props) {
  const [importError, setImportError] = useState<string | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as BackupSnapshot
      await onImportManual(parsed)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      e.target.value = ''
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-danger">
        No pudimos abrir tu base de datos
      </h1>
      <pre className="mt-4 whitespace-pre-wrap rounded bg-surface-2 p-3 text-xs text-ink-muted">
        {error}
      </pre>
      {backups.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">
          No hay backups automáticos disponibles.
        </p>
      ) : (
        <>
          <h2 className="mt-8 text-base font-medium">Backups automáticos</h2>
          <ul className="mt-3 space-y-2">
            {backups.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => void onRestore(f)}
                  className="w-full rounded border border-line px-4 py-3 text-left text-sm hover:bg-surface-2"
                >
                  {humanizeBackupName(f)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <h2 className="text-base font-medium">Importar backup manual</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Seleccioná un archivo JSON exportado previamente.
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded border border-line-strong px-3 py-2 text-sm hover:bg-surface-2">
          Elegir archivo
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
            className="hidden"
          />
        </label>
        {importError && (
          <p className="mt-2 text-xs text-danger">{importError}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onRetry}
        className="mt-8 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition-colors duration-150 hover:bg-accent-hover"
      >
        Reintentar
      </button>
    </main>
  )
}
