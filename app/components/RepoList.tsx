"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button, Col, Pagination, Row, Spin, message } from "antd"
import { SyncOutlined } from "@ant-design/icons"
import FilterBar, { type FilterValues } from "./FilterBar"
import RepoCard, { type RepoCardData } from "./RepoCard"
import type { TagOption } from "./TagSelect"

interface RepoListProps {
  source: "owned" | "starred"
}

interface ReposResponse {
  items: RepoCardData[]
  total: number
  page: number
  perPage: number
  languages: string[]
}

const DEFAULT_FILTERS: FilterValues = {
  search: "",
  searchDescription: "true",
  type: "all",
  language: "all",
  sort: "updated",
  favorite: "all",
  note: "all",
  tag: "all",
}

function filtersFromSearchParams(sp: URLSearchParams): FilterValues {
  return {
    search: sp.get("search") ?? DEFAULT_FILTERS.search,
    searchDescription: (sp.get("searchDescription") as FilterValues["searchDescription"]) ?? DEFAULT_FILTERS.searchDescription,
    type: (sp.get("type") as FilterValues["type"]) ?? DEFAULT_FILTERS.type,
    language: sp.get("language") ?? DEFAULT_FILTERS.language,
    sort: (sp.get("sort") as FilterValues["sort"]) ?? DEFAULT_FILTERS.sort,
    favorite: (sp.get("favorite") as FilterValues["favorite"]) ?? DEFAULT_FILTERS.favorite,
    note: (sp.get("note") as FilterValues["note"]) ?? DEFAULT_FILTERS.note,
    tag: sp.get("tag") ?? DEFAULT_FILTERS.tag,
  }
}

export default function RepoList({ source }: RepoListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const page = Number(searchParams.get("page") ?? "1")
  const perPage = Number(searchParams.get("perPage") ?? "30")

  const [data, setData] = useState<ReposResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [allTags, setAllTags] = useState<TagOption[]>([])

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/tags")
    const json = await res.json()
    setAllTags(json.tags)
  }, [])

  const fetchRepos = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        source,
        page: String(page),
        perPage: String(perPage),
        search: filters.search,
        searchDescription: filters.searchDescription,
        type: filters.type,
        language: filters.language,
        sort: filters.sort,
        favorite: filters.favorite,
        note: filters.note,
      })
      if (filters.tag === "untagged") {
        qs.set("tagId", "untagged")
      } else if (filters.tag !== "all") {
        qs.set("tagId", filters.tag)
      }

      const res = await fetch(`/api/repos?${qs.toString()}`)
      const json = await res.json()
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [source, page, perPage, filters])

  useEffect(() => {
    // 取数后必然 setState，react-hooks/set-state-in-effect 对所有 fetch-on-mount 都会报错
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags()
  }, [fetchTags])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRepos()
  }, [fetchRepos])

  const updateFilters = (next: FilterValues) => {
    const qs = new URLSearchParams({ ...next, page: "1", perPage: String(perPage) })
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

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/sync", { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        message.error(json.error ?? "同步失败")
        return
      }
      message.success(`同步完成：owned ${json.ownedCount} / starred ${json.starredCount}`)
      fetchRepos()
    } finally {
      setSyncing(false)
    }
  }

  const callAndRefresh = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      message.error(json.error ?? "操作失败")
      return false
    }
    return true
  }

  const handleToggleFavorite = async (id: number, next: boolean) => {
    if (await callAndRefresh(`/api/repos/${id}/favorite`, "PATCH", { isFavorite: next })) {
      fetchRepos()
    }
  }

  const handleToggleStar = async (id: number, next: boolean) => {
    if (await callAndRefresh(`/api/repos/${id}/star`, next ? "PUT" : "DELETE")) {
      fetchRepos()
    }
  }

  const handleSaveNote = async (id: number, note: string) => {
    if (await callAndRefresh(`/api/repos/${id}/note`, "PATCH", { note })) {
      fetchRepos()
    }
  }

  const handleChangeTags = async (id: number, tagNames: string[]) => {
    if (await callAndRefresh(`/api/repos/${id}/tags`, "PUT", { tagNames })) {
      await fetchTags()
      fetchRepos()
    }
  }

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }} gutter={[16, 16]}>
        <Col flex="auto">
          <FilterBar
            value={filters}
            languages={data?.languages ?? []}
            tags={allTags}
            showStarredSort={source === "starred"}
            onChange={updateFilters}
          />
        </Col>
        <Col>
          <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing}>
            同步
          </Button>
        </Col>
      </Row>

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          {data?.items.map((repo) => (
            <Col key={repo.id} xs={24} sm={12} lg={8}>
              <RepoCard
                repo={repo}
                allTags={allTags}
                onToggleFavorite={handleToggleFavorite}
                onToggleStar={handleToggleStar}
                onSaveNote={handleSaveNote}
                onChangeTags={handleChangeTags}
              />
            </Col>
          ))}
        </Row>
      </Spin>

      {data && (
        <Row justify="end" style={{ marginTop: 16 }}>
          <Pagination
            current={data.page}
            pageSize={data.perPage}
            total={data.total}
            onChange={updatePage}
            showSizeChanger
            pageSizeOptions={[10, 20, 30, 50, 100]}
          />
        </Row>
      )}
    </div>
  )
}
