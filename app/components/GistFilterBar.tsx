"use client"

import type { ReactNode } from "react"
import { Input, Select } from "antd"
import { SortAscendingOutlined } from "@ant-design/icons"
import type { TagOption } from "./TagSelect"

export interface GistFilterValues {
  search: string
  type: "all" | "public" | "secret"
  sort: "created" | "created_asc" | "updated" | "updated_asc" | "stars"
  favorite: "all" | "favorite" | "not_favorite"
  note: "all" | "noted" | "not_noted"
  tag: string
}

interface GistFilterBarProps {
  value: GistFilterValues
  tags: TagOption[]
  onChange: (next: GistFilterValues) => void
}

/** GitHub 官方 gist 列表的排序项 */
const SORT_OPTIONS = [
  { label: "Recently created", value: "created" },
  { label: "Least recently created", value: "created_asc" },
  { label: "Recently updated", value: "updated" },
  { label: "Least recently updated", value: "updated_asc" },
  { label: "Most stars", value: "stars" },
]

const TYPE_OPTIONS = [
  { label: "类型：All", value: "all" },
  { label: "Public", value: "public" },
  { label: "Secret", value: "secret" },
]

const FAVORITE_OPTIONS = [
  { label: "收藏：全部", value: "all" },
  { label: "已收藏", value: "favorite" },
  { label: "未收藏", value: "not_favorite" },
]

const NOTE_OPTIONS = [
  { label: "备注：全部", value: "all" },
  { label: "已备注", value: "noted" },
  { label: "未备注", value: "not_noted" },
]

const SHARED_SELECT = {
  // 必须指定 optionFilterProp：默认值会按 option.value 过滤，
  // 而这些下拉框的 value 是英文/数字 id，label 才是用户看到的文案
  showSearch: { optionFilterProp: "label" },
  allowClear: true,
}

export default function GistFilterBar({
  value,
  tags,
  onChange,
}: GistFilterBarProps) {
  // 按层级路径排序，同一父标签下的子标签会挨在一起
  const tagOptions: {
    label: string
    value: string
    repoCount?: number
    depth?: number
  }[] = [
    { label: "标签：全部", value: "all" },
    { label: "未打标", value: "untagged" },
    ...[...tags]
      .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name))
      .map((tag) => ({
        label: tag.path ?? tag.name,
        value: String(tag.id),
        repoCount: tag.totalRepoCount ?? tag.repoCount ?? 0,
        depth: tag.depth ?? 1,
      })),
  ]

  return (
    <div className="mb-4 flex flex-col gap-3">
      <Input.Search
        placeholder="Find a gist...（描述 / 文件名 / 内容）"
        allowClear
        defaultValue={value.search}
        onSearch={(search) => onChange({ ...value, search })}
        className="w-full sm:w-[320px]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          {...SHARED_SELECT}
          value={value.type}
          options={TYPE_OPTIONS}
          className="min-w-[110px] flex-1 sm:max-w-[130px]"
          onChange={(type) => onChange({ ...value, type: type ?? "all" })}
        />
        <Select
          {...SHARED_SELECT}
          value={value.favorite}
          options={FAVORITE_OPTIONS}
          className="min-w-[120px] flex-1 sm:max-w-[140px]"
          onChange={(favorite) =>
            onChange({ ...value, favorite: favorite ?? "all" })
          }
        />
        <Select
          {...SHARED_SELECT}
          value={value.note}
          options={NOTE_OPTIONS}
          className="min-w-[120px] flex-1 sm:max-w-[140px]"
          onChange={(note) => onChange({ ...value, note: note ?? "all" })}
        />
        <Select
          {...SHARED_SELECT}
          value={value.tag}
          options={tagOptions}
          className="min-w-[120px] flex-1 sm:max-w-[160px]"
          onChange={(tag) => onChange({ ...value, tag: tag ?? "all" })}
          optionRender={(option) => {
            const { label, data } = option as {
              label: ReactNode
              data: {
                value?: string | number
                repoCount?: number
                depth?: number
              }
            }
            const optionValue = data?.value ?? option.value
            if (optionValue === "all" || optionValue === "untagged") {
              return <span>{label}</span>
            }
            // 子标签按层级缩进，一眼看出归属
            const indent = Math.max((data?.depth ?? 1) - 1, 0) * 12
            return (
              <span className="flex items-center justify-between gap-3">
                <span style={{ paddingLeft: indent }}>{label}</span>
                <span className="text-xs opacity-60">
                  {data?.repoCount ?? 0}
                </span>
              </span>
            )
          }}
        />
        <Select
          {...SHARED_SELECT}
          value={value.sort}
          options={SORT_OPTIONS}
          suffixIcon={<SortAscendingOutlined />}
          className="ml-auto min-w-[160px] sm:max-w-[200px]"
          onChange={(sort) => onChange({ ...value, sort: sort ?? "created" })}
        />
      </div>
    </div>
  )
}
