"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { message } from "antd"

interface SyncState {
  lastSyncedAt: string | null
  syncing: boolean
  syncVersion: number
  triggerSync: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: React.PropsWithChildren) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncVersion, setSyncVersion] = useState(0)

  useEffect(() => {
    fetch("/api/sync")
      .then((res) => res.json())
      .then((json) => setLastSyncedAt(json.lastSyncedAt ?? null))
  }, [])

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
    } finally {
      setSyncing(false)
    }
  }, [])

  return (
    <SyncContext.Provider
      value={{ lastSyncedAt, syncing, syncVersion, triggerSync }}
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
