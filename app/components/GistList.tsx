"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { App, Col, Empty, Pagination, Row, Spin, theme } from "antd"
import GistFilterBar, { type GistFilterValues } from "./GistFilterBar"
import GistCard, { type GistCardData } from "./GistCard"
import type { TagOption } from "./TagSelect"
import { useSync } from "./SyncContext"
import { fetchJson, parseJsonResponse } from "../lib/api-client"

interface GistListProps {
  source: "owned" | "starred"
}

interface GistsResponse {
  items: GistCardData[]
  total: number
  page: number
  perPage: number
}

const DEFAULT_FILTERS: GistFilterValues = {
  search: "",
  type: "all",
  sort: "created",
  favorite: "all",
  note: "all",
  tag: "all",
}

function filtersFromSearchParams(sp: URLSearchParams): GistFilterValues {
  return {
    search: sp.get("search") ?? DEFAULT_FILTERS.search,
    type: (sp.get("type") as GistFilterValues["type"]) ?? DEFAULT_FILTERS.type,
    sort: (sp.get("sort") as GistFilterValues["sort"]) ?? DEFAULT_FILTERS.sort,
    favorite:
      (sp.get("favorite") as GistFilterValues["favorite"]) ??
      DEFAULT_FILTERS.favorite,
    note: (sp.get("note") as GistFilterValues["note"]) ?? DEFAULT_FILTERS.note,
    tag: sp.get("tag") ?? DEFAULT_FILTERS.tag,
  }
}

export default function GistList({ source }: GistListProps) {
  const { token } = theme.useToken()
  const router = useRouter()
  const searchParams = useSearchParams()
  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  )
  const page = Number(searchParams.get("page") ?? "1")
  const perPage = Number(searchParams.get("perPage") ?? "30")

  const { syncVersion, refreshCounts } = useSync()
  const { message } = App.useApp()
  const [data, setData] = useState<GistsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [allTags, setAllTags] = useState<TagOption[]>([])

  const fetchTags = useCallback(async () => {
    try {
      const json = await fetchJson<{ tags: TagOption[] }>(
        `/api/tags?scope=gist&source=${source}`,
      )
      setAllTags(json.tags)
    } catch (error) {
      message.error(
        error instanceof Error
          ? `获取标签失败: ${error.message}`
          : "获取标签失败",
      )
    }
  }, [source, message])

  const fetchGists = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        source,
        page: String(page),
        perPage: String(perPage),
        search: filters.search,
        type: filters.type,
        sort: filters.sort,
        favorite: filters.favorite,
        note: filters.note,
      })
      if (filters.tag === "untagged") {
        qs.set("tagId", "untagged")
      } else if (filters.tag !== "all") {
        qs.set("tagId", filters.tag)
      }

      setData(await fetchJson<GistsResponse>(`/api/gists?${qs.toString()}`))
    } catch (error) {
      message.error(
        error instanceof Error
          ? `获取 Gist 失败: ${error.message}`
          : "获取 Gist 失败",
      )
    } finally {
      setLoading(false)
    }
    // syncVersion 不在函数体内使用，仅作为"全局同步完成"的刷新信号触发重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, page, perPage, filters, syncVersion])

  useEffect(() => {
    // 取数后必然 setState，react-hooks/set-state-in-effect 对所有 fetch-on-mount 都会报错
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags()
  }, [fetchTags])

  // 深链 ?tag=<id> 指向已被删除/不属于当前用户的标签时，列表会静默为空。
  // 这里检测出来并把筛选重置为「全部」，同时给用户一句提示。
  useEffect(() => {
    if (allTags.length === 0) return
    if (filters.tag === "all" || filters.tag === "untagged") return
    const tagId = Number(filters.tag)
    if (!Number.isInteger(tagId)) return
    if (allTags.some((tag) => tag.id === tagId)) return

    message.info("该标签已不存在，已重置筛选为「全部」")
    const next = new URLSearchParams(searchParams.toString())
    next.set("tag", "all")
    next.delete("page")
    router.replace(`?${next.toString()}`)
    // 仅在 allTags 加载完成后、检测到失效 id 时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTags, filters.tag])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGists()
  }, [fetchGists])

  const updateFilters = (next: GistFilterValues) => {
    const qs = new URLSearchParams({
      ...next,
      page: "1",
      perPage: String(perPage),
    })
    router.push(`?${qs.toString()}`)
  }

  const updatePage = (nextPage: number, nextPerPage: number) => {
    const qs = new URLSearchParams({
      ...filters,
      page: String(nextPerPage !== perPage ? 1 : nextPage),
      perPage: String(nextPerPage),
    })
    router.push(`?${qs.toString()}`)
  }

  const callAndRefresh = async (
    path: string,
    method: string,
    body?: unknown,
  ): Promise<boolean> => {
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) await parseJsonResponse(res)
      return true
    } catch (error) {
      message.error(
        error instanceof Error ? `操作失败: ${error.message}` : "操作失败",
      )
      return false
    }
  }

  const handleToggleFavorite = async (id: string, next: boolean) => {
    if (
      await callAndRefresh(`/api/gists/${id}/favorite`, "PATCH", {
        isFavorite: next,
      })
    ) {
      fetchGists()
    }
  }

  const handleToggleStar = async (id: string, next: boolean) => {
    if (
      await callAndRefresh(`/api/gists/${id}/star`, next ? "PUT" : "DELETE")
    ) {
      fetchGists()
      refreshCounts()
    }
  }

  const handleSaveNote = async (id: string, note: string) => {
    if (await callAndRefresh(`/api/gists/${id}/note`, "PATCH", { note })) {
      fetchGists()
    }
  }

  const handleChangeTags = async (
    id: string,
    tagIds: number[],
    newTagNames: string[],
  ) => {
    if (
      await callAndRefresh(`/api/gists/${id}/tags`, "PUT", {
        tagIds,
        newTagNames,
      })
    ) {
      await fetchTags()
      fetchGists()
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <GistFilterBar
          value={filters}
          tags={allTags}
          onChange={updateFilters}
        />
      </div>

      <Spin spinning={loading}>
        {!loading && data && data.items.length === 0 ? (
          <Empty
            style={{ margin: "80px 0" }}
            description={data ? "没有匹配的 Gist" : undefined}
          />
        ) : (
          <Row gutter={[{ xs: 8, sm: 16, lg: 24 }, 16]}>
            {data?.items.map((gist) => (
              <Col key={gist.id} xs={24} sm={12} lg={8}>
                <GistCard
                  gist={gist}
                  allTags={allTags}
                  keyword={filters.search || undefined}
                  onToggleFavorite={handleToggleFavorite}
                  onToggleStar={handleToggleStar}
                  onSaveNote={handleSaveNote}
                  onChangeTags={handleChangeTags}
                />
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      {data && <div style={{ height: 64 }} />}

      {data && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            background: token.colorBgContainer,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <div className="page-container flex justify-center px-4 py-3 sm:justify-end">
            <Pagination
              current={data.page}
              pageSize={data.perPage}
              total={data.total}
              onChange={updatePage}
              showSizeChanger
              pageSizeOptions={[10, 20, 30, 50, 100]}
              showTotal={(total) => `Total ${total} items`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
