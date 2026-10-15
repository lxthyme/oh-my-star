"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { message } from "antd"
import { fetchJson } from "../lib/api-client"

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
    try {
      setRepoCounts(await fetchJson<RepoCounts>("/api/repos/counts"))
    } catch (error) {
      message.error(error instanceof Error ? `获取仓库数量失败: ${error.message}` : "获取仓库数量失败")
    }
  }, [])

  useEffect(() => {
    fetchJson<{ lastSyncedAt?: string | null }>("/api/sync")
      .then((json) => setLastSyncedAt(json.lastSyncedAt ?? null))
      .catch((error: unknown) =>
        message.error(
          error instanceof Error ? `获取同步状态失败: ${error.message}` : "获取同步状态失败",
        ),
      )
    // 取数后必然 setState，react-hooks/set-state-in-effect 对此场景误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCounts()
  }, [refreshCounts])

  const triggerSync = useCallback(async () => {
    setSyncing(true)
    try {
      const json = await fetchJson<{
        ownedCount: number
        starredCount: number
      }>("/api/sync", { method: "POST" })
      message.success(
        `同步完成：owned ${json.ownedCount} / starred ${json.starredCount}`,
      )
      setLastSyncedAt(new Date().toISOString())
      setSyncVersion((v) => v + 1)
      await refreshCounts()
    } catch (error) {
      message.error(error instanceof Error ? `同步失败: ${error.message}` : "同步失败")
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
