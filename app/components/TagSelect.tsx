"use client"

import { useState } from "react"
import { Select } from "antd"

export interface TagOption {
  id: number
  name: string
  /** 该标签下的 repo 数量，由 /api/tags 按当前列表来源统计 */
  repoCount?: number
  /** 含子孙标签的 repo 数量（同一 repo 只计一次） */
  totalRepoCount?: number
  /** 层级路径，如「工具 / CLI」 */
  path?: string
  /** 层级深度，顶级标签为 1 */
  depth?: number
}

interface TagSelectProps {
  allTags: TagOption[]
  value: string[]
  onChange: (tagNames: string[]) => void
}

const CREATE_PREFIX = "__create__:"

export default function TagSelect({
  allTags,
  value,
  onChange,
}: TagSelectProps) {
  const [keyword, setKeyword] = useState("")

  const name = keyword.trim()
  const creatable =
    name.length > 0 &&
    !allTags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())

  const options = [
    ...(creatable
      ? [{ label: `创建标签「${name}」`, value: `${CREATE_PREFIX}${name}` }]
      : []),
    ...allTags.map((tag) => ({ label: tag.name, value: tag.name })),
  ]

  return (
    <Select
      mode="multiple"
      size="small"
      style={{ minWidth: 160 }}
      placeholder="添加标签"
      value={value}
      options={options}
      onSearch={setKeyword}
      filterOption={(input, option) =>
        String(option?.label ?? "")
          .toLowerCase()
          .includes(input.trim().toLowerCase())
      }
      onChange={(next) =>
        onChange(
          (next as string[]).map((item) =>
            item.startsWith(CREATE_PREFIX)
              ? item.slice(CREATE_PREFIX.length)
              : item,
          ),
        )
      }
    />
  )
}
