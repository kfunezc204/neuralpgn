import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Repository } from './Repository.ts'
import { TauriSqlAdapter } from './TauriSqlAdapter.ts'
import { TauriFsAdapter, getAppDataDir } from './TauriFsAdapter.ts'
import { ProfileStore, type Profile } from './ProfileStore.ts'
import { BackupSerializer, type BackupSnapshot } from './BackupSerializer.ts'
import { BackupManager } from './BackupManager.ts'
import { ProfileProvider } from './ProfileContext.tsx'
import { readSoundEnabled } from './AppSettings.ts'
import { setSoundEnabled } from './FeedbackSounds.ts'
import { computeProfileSummary } from './ProfileSummary.ts'
import { ProfileSelector } from '../components/ProfileSelector.tsx'
import { RecoveryScreen } from '../components/RecoveryScreen.tsx'

type Phase =
  | { kind: 'loading' }
  // bootedProfileId: profile whose DB connection is open from a prior boot
  // this session (selector reached via "switch profile"); its files are
  // locked, so deleting it is disallowed until next app start.
  | { kind: 'selecting'; profiles: Profile[]; bootedProfileId?: string }
  | { kind: 'booting'; profile: Profile }
  | { kind: 'ready'; profile: Profile; repo: Repository }
  | { kind: 'recovery'; profile: Profile; error: string; backups: string[] }
  | { kind: 'error'; error: string }

const Ctx = createContext<Repository | null>(null)

const PROFILES_FILE = 'profiles.json'
const BACKUPS_DIR = 'backups'
const KEEP_BACKUPS = 10

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const profileStoreRef = useRef<ProfileStore | null>(null)
  const appDataRef = useRef<string>('')
  const fsRef = useRef<TauriFsAdapter | null>(null)

  const bootProfile = useCallback(async (profile: Profile) => {
    setPhase({ kind: 'booting', profile })
    const dbUrl = `sqlite:${profile.db_filename}`
    try {
      const adapter = await TauriSqlAdapter.open(dbUrl)
      const repo = new Repository(adapter)
      await repo.migrate()
      // Feedback sounds honor this profile's persisted preference.
      setSoundEnabled(await readSoundEnabled(repo))
      // Selector snapshot: freshest data we can guarantee without hooking
      // app shutdown. Re-taken on profile switch (see handleRequestSwitch).
      try {
        await profileStoreRef.current!.updateSummary(
          profile.id,
          await computeProfileSummary(repo),
        )
      } catch {
        // Snapshot failure is non-fatal.
      }
      // Best-effort auto-backup once per session.
      try {
        const fs = fsRef.current!
        const manager = new BackupManager(fs, new BackupSerializer(), {
          dir: `${appDataRef.current}/${BACKUPS_DIR}/${profile.id}`,
          keep: KEEP_BACKUPS,
        })
        await manager.writeBackup(repo)
      } catch {
        // Backup failure is non-fatal.
      }
      setPhase({ kind: 'ready', profile, repo })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        const fs = fsRef.current!
        const manager = new BackupManager(fs, new BackupSerializer(), {
          dir: `${appDataRef.current}/${BACKUPS_DIR}/${profile.id}`,
          keep: KEEP_BACKUPS,
        })
        const backups = await manager.listBackups()
        setPhase({ kind: 'recovery', profile, error: message, backups })
      } catch {
        setPhase({ kind: 'error', error: message })
      }
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const appData = await getAppDataDir()
        appDataRef.current = appData
        const fs = new TauriFsAdapter()
        fsRef.current = fs
        const store = new ProfileStore(fs, `${appData}/${PROFILES_FILE}`)
        await store.load()
        profileStoreRef.current = store

        const profiles = store.listProfiles()
        if (profiles.length === 0) {
          setPhase({ kind: 'selecting', profiles: [] })
          return
        }
        const active = store.getActiveProfile()
        if (active && profiles.length === 1) {
          await bootProfile(active)
          return
        }
        setPhase({ kind: 'selecting', profiles })
      } catch (err) {
        setPhase({
          kind: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, [bootProfile])

  const handleSelectProfile = useCallback(
    async (id: string) => {
      const store = profileStoreRef.current!
      await store.setActiveProfile(id)
      const profile = store.listProfiles().find((p) => p.id === id)!
      await bootProfile(profile)
    },
    [bootProfile],
  )

  const handleCreateProfile = useCallback(
    async (name: string) => {
      const store = profileStoreRef.current!
      const profile = await store.createProfile(name)
      await store.setActiveProfile(profile.id)
      await bootProfile(profile)
    },
    [bootProfile],
  )

  const handleSwitchFromApp = useCallback(
    async (id: string) => {
      const store = profileStoreRef.current!
      await store.setActiveProfile(id)
      const profile = store.listProfiles().find((p) => p.id === id)!
      // Force re-mount of routes by going through booting state.
      await bootProfile(profile)
    },
    [bootProfile],
  )

  const handleRequestSwitch = useCallback(() => {
    const store = profileStoreRef.current!
    setPhase((prev) => {
      // Leaving a live session: refresh this profile's selector snapshot so
      // the list reflects what just happened (fire-and-forget; the selector
      // re-reads the store on every render anyway).
      if (prev.kind === 'ready') {
        void computeProfileSummary(prev.repo)
          .then(async (s) => {
            await store.updateSummary(prev.profile.id, s)
            // Re-render the selector with the fresh snapshot if still open.
            setPhase((p) =>
              p.kind === 'selecting'
                ? { ...p, profiles: store.listProfiles() }
                : p,
            )
          })
          .catch(() => {})
      }
      return {
        kind: 'selecting',
        profiles: store.listProfiles(),
        ...(prev.kind === 'ready' ? { bootedProfileId: prev.profile.id } : {}),
      }
    })
  }, [])

  const handleDeleteProfile = useCallback(async (id: string) => {
    const store = profileStoreRef.current!
    const removed = await store.deleteProfile(id)
    // Best-effort cleanup of the profile's data files. The registry entry is
    // the source of truth; an orphaned file is harmless and a locked one
    // simply stays behind.
    try {
      const fs = fsRef.current!
      await fs.remove(`${appDataRef.current}/${removed.db_filename}`)
      const backupsDir = `${appDataRef.current}/${BACKUPS_DIR}/${removed.id}`
      for (const f of await fs.listDir(backupsDir)) {
        await fs.remove(`${backupsDir}/${f}`)
      }
    } catch {
      // non-fatal
    }
    setPhase((prev) => ({
      kind: 'selecting',
      profiles: store.listProfiles(),
      ...(prev.kind === 'selecting' && prev.bootedProfileId
        ? { bootedProfileId: prev.bootedProfileId }
        : {}),
    }))
  }, [])

  const handleRestoreBackup = useCallback(
    async (filename: string) => {
      if (phase.kind !== 'recovery') return
      const fs = fsRef.current!
      const manager = new BackupManager(fs, new BackupSerializer(), {
        dir: `${appDataRef.current}/${BACKUPS_DIR}/${phase.profile.id}`,
        keep: KEEP_BACKUPS,
      })
      // Wipe corrupt DB file by recreating connection over fresh schema, then restore.
      const dbUrl = `sqlite:${phase.profile.db_filename}`
      const adapter = await TauriSqlAdapter.open(dbUrl)
      const repo = new Repository(adapter)
      await repo.migrate()
      await manager.restoreBackup(repo, filename)
      setPhase({ kind: 'ready', profile: phase.profile, repo })
    },
    [phase],
  )

  const handleRetry = useCallback(() => {
    if (phase.kind === 'recovery') void bootProfile(phase.profile)
  }, [phase, bootProfile])

  const handleImportManual = useCallback(
    async (snap: BackupSnapshot) => {
      if (phase.kind !== 'recovery') return
      const dbUrl = `sqlite:${phase.profile.db_filename}`
      const adapter = await TauriSqlAdapter.open(dbUrl)
      const repo = new Repository(adapter)
      await repo.migrate()
      await new BackupSerializer().restore(repo, snap)
      setPhase({ kind: 'ready', profile: phase.profile, repo })
    },
    [phase],
  )

  if (phase.kind === 'loading') {
    return <div className="p-6 text-sm text-ink-muted">Loading…</div>
  }
  if (phase.kind === 'selecting') {
    return (
      <ProfileSelector
        profiles={phase.profiles}
        onSelect={handleSelectProfile}
        onCreate={handleCreateProfile}
        onDelete={handleDeleteProfile}
        bootedProfileId={phase.bootedProfileId}
      />
    )
  }
  if (phase.kind === 'booting') {
    return (
      <div className="p-6 text-sm text-ink-muted">
        Opening profile “{phase.profile.name}”…
      </div>
    )
  }
  if (phase.kind === 'recovery') {
    return (
      <RecoveryScreen
        error={phase.error}
        backups={phase.backups}
        onRestore={handleRestoreBackup}
        onImportManual={handleImportManual}
        onRetry={handleRetry}
      />
    )
  }
  if (phase.kind === 'error') {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-danger">Startup error</h1>
        <pre className="mt-2 whitespace-pre-wrap text-sm">{phase.error}</pre>
      </div>
    )
  }

  const store = profileStoreRef.current!
  return (
    <Ctx.Provider value={phase.repo}>
      <ProfileProvider
        value={{
          active: phase.profile,
          all: store.listProfiles(),
          switchTo: handleSwitchFromApp,
          create: handleCreateProfile,
          requestSwitch: handleRequestSwitch,
        }}
      >
        {children}
      </ProfileProvider>
    </Ctx.Provider>
  )
}

export function useRepository(): Repository {
  const r = useContext(Ctx)
  if (!r) throw new Error('useRepository called outside RepositoryProvider')
  return r
}
