"use client"

import { Input, Select, Space, Switch } from "antd"
import type { TagOption } from "./TagSelect"

export interface FilterValues {
  search: string
  searchDescription: "true" | "false"
  type: "all" | "sources" | "forks" | "archived" | "mirrors" | "templates"
  language: string
  sort: "updated" | "name" | "stars" | "starred_at"
  favorite: "all" | "favorite" | "not_favorite"
  note: "all" | "noted" | "not_noted"
  tag: string
}

interface FilterBarProps {
  value: FilterValues
  languages: string[]
  tags: TagOption[]
  showStarredSort: boolean
  onChange: (next: FilterValues) => void
}

const TYPE_OPTIONS_OWNED = [
  { label: "All", value: "all" },
  { label: "Sources", value: "sources" },
  { label: "Forks", value: "forks" },
  { label: "Archived", value: "archived" },
  { label: "Mirrors", value: "mirrors" },
  { label: "Templates", value: "templates" },
]

const TYPE_OPTIONS_STARRED = [
  { label: "All", value: "all" },
  { label: "Sources", value: "sources" },
  { label: "Forks", value: "forks" },
  { label: "Mirrors", value: "mirrors" },
  { label: "Templates", value: "templates" },
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

export default function FilterBar({ value, languages, tags, showStarredSort, onChange }: FilterBarProps) {
  const typeOptions = showStarredSort ? TYPE_OPTIONS_STARRED : TYPE_OPTIONS_OWNED

  const sortOptions = showStarredSort
    ? [
        { label: "Recently starred", value: "starred_at" },
        { label: "Recently active", value: "updated" },
        { label: "Most stars", value: "stars" },
      ]
    : [
        { label: "Last updated", value: "updated" },
        { label: "Name", value: "name" },
        { label: "Stars", value: "stars" },
      ]

  const tagOptions = [
    { label: "标签：全部", value: "all" },
    { label: "未打标", value: "untagged" },
    ...tags.map((tag) => ({ label: tag.name, value: String(tag.id) })),
  ]

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search
        placeholder="Find a repository..."
        allowClear
        defaultValue={value.search}
        onSearch={(search) => onChange({ ...value, search })}
        style={{ width: 220 }}
      />
      <Space size={4}>
        <span>搜索描述</span>
        <Switch
          size="small"
          checked={value.searchDescription !== "false"}
          onChange={(checked) => onChange({ ...value, searchDescription: checked ? "true" : "false" })}
        />
      </Space>
      <Select
        value={value.type}
        options={typeOptions}
        style={{ width: 140 }}
        onChange={(type) => onChange({ ...value, type })}
      />
      <Select
        value={value.language}
        options={[{ label: "语言：全部", value: "all" }, ...languages.map((lang) => ({ label: lang, value: lang }))]}
        style={{ width: 160 }}
        onChange={(language) => onChange({ ...value, language })}
      />
      <Select
        value={value.sort}
        options={sortOptions}
        style={{ width: 160 }}
        onChange={(sort) => onChange({ ...value, sort })}
      />
      <Select
        value={value.favorite}
        options={FAVORITE_OPTIONS}
        style={{ width: 140 }}
        onChange={(favorite) => onChange({ ...value, favorite })}
      />
      <Select
        value={value.note}
        options={NOTE_OPTIONS}
        style={{ width: 140 }}
        onChange={(note) => onChange({ ...value, note })}
      />
      <Select
        value={value.tag}
        options={tagOptions}
        style={{ width: 160 }}
        onChange={(tag) => onChange({ ...value, tag })}
      />
    </Space>
  )
}
