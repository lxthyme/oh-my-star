"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { message } from "antd"

interface RepoCounts {
  owned: number
  starred: number
}

interface SyncState {
  lastSyncedAt: string | null
  syncing: boolean
  syncVersion: number
  triggerSync: () => Promise<void>
  repoCounts: RepoCounts | null
  refreshCounts: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: React.PropsWithChildren) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncVersion, setSyncVersion] = useState(0)
  const [repoCounts, setRepoCounts] = useState<RepoCounts | null>(null)

  const refreshCounts = useCallback(async () => {
    const res = await fetch("/api/repos/counts")
    const json = await res.json()
    setRepoCounts(json)
  }, [])

  useEffect(() => {
    fetch("/api/sync")
      .then((res) => res.json())
      .then((json) => setLastSyncedAt(json.lastSyncedAt ?? null))
    // 取数后必然 setState，react-hooks/set-state-in-effect 对此场景误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCounts()
  }, [refreshCounts])

  const triggerSync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/sync", { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        message.error(json.error ?? "同步失败")
        return
      }
      message.success(
        `同步完成：owned ${json.ownedCount} / starred ${json.starredCount}`,
      )
      setLastSyncedAt(new Date().toISOString())
      setSyncVersion((v) => v + 1)
      await refreshCounts()
    } finally {
      setSyncing(false)
    }
  }, [refreshCounts])

  return (
    <SyncContext.Provider
      value={{
        lastSyncedAt,
        syncing,
        syncVersion,
        triggerSync,
        repoCounts,
        refreshCounts,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSync 必须在 SyncProvider 内使用")
  return ctx
}
