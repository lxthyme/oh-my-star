"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { App } from "antd"
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
  gistCounts: RepoCounts | null
  refreshCounts: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: React.PropsWithChildren) {
  const { message } = App.useApp()
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncVersion, setSyncVersion] = useState(0)
  const [repoCounts, setRepoCounts] = useState<RepoCounts | null>(null)
  const [gistCounts, setGistCounts] = useState<RepoCounts | null>(null)

  const refreshCounts = useCallback(async () => {
    const [repos, gists] = await Promise.allSettled([
      fetchJson<RepoCounts>("/api/repos/counts"),
      fetchJson<RepoCounts>("/api/gists/counts"),
    ])
    if (repos.status === "fulfilled") {
      setRepoCounts(repos.value)
    } else {
      const error = repos.reason
      message.error(
        error instanceof Error
          ? `获取仓库数量失败: ${error.message}`
          : "获取仓库数量失败",
      )
    }
    if (gists.status === "fulfilled") {
      setGistCounts(gists.value)
    } else {
      const error = gists.reason
      message.error(
        error instanceof Error
          ? `获取 Gist 数量失败: ${error.message}`
          : "获取 Gist 数量失败",
      )
    }
  }, [message])

  useEffect(() => {
    fetchJson<{ lastSyncedAt?: string | null }>("/api/sync")
      .then((json) => setLastSyncedAt(json.lastSyncedAt ?? null))
      .catch((error: unknown) =>
        message.error(
          error instanceof Error
            ? `获取同步状态失败: ${error.message}`
            : "获取同步状态失败",
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
        gistOwnedCount: number
        gistStarredCount: number
      }>("/api/sync", { method: "POST" })
      message.success(
        `同步完成：仓库 owned ${json.ownedCount} / starred ${json.starredCount}；Gist owned ${json.gistOwnedCount} / starred ${json.gistStarredCount}`,
      )
      setLastSyncedAt(new Date().toISOString())
      setSyncVersion((v) => v + 1)
      await refreshCounts()
    } catch (error) {
      message.error(
        error instanceof Error ? `同步失败: ${error.message}` : "同步失败",
      )
    } finally {
      setSyncing(false)
    }
  }, [refreshCounts, message])

  return (
    <SyncContext.Provider
      value={{
        lastSyncedAt,
        syncing,
        syncVersion,
        triggerSync,
        repoCounts,
        gistCounts,
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
