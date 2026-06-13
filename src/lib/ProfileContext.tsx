import { createContext, useContext, type ReactNode } from 'react'
import type { Profile } from './ProfileStore.ts'

interface ProfileContextValue {
  active: Profile
  all: Profile[]
  switchTo: (id: string) => Promise<void>
  create: (name: string) => Promise<void>
  requestSwitch: () => void
}

const Ctx = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({
  value,
  children,
}: {
  value: ProfileContextValue
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProfile(): ProfileContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProfile called outside ProfileProvider')
  return v
}
