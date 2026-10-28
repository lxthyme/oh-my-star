"use client"

import { useState } from "react"
import type { ReactNode } from "react"
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
  /** 已选中的标签 id */
  value: number[]
  /** 返回已选标签 id 与需要新建的标签名（来自「创建标签」选项） */
  onChange: (tagIds: number[], newTagNames: string[]) => void
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

  // 与筛选下拉一致：按层级路径排序，同一父标签下的子标签挨在一起
  const sortedTags = [...allTags].sort((a, b) =>
    (a.path ?? a.name).localeCompare(b.path ?? b.name),
  )

  const options: {
    label: string
    value: number | string
    repoCount?: number
    depth?: number
  }[] = [
    ...(creatable
      ? [{ label: `创建标签「${name}」`, value: `${CREATE_PREFIX}${name}` }]
      : []),
    ...sortedTags.map((tag) => ({
      label: tag.path ?? tag.name,
      value: tag.id,
      repoCount: tag.totalRepoCount ?? tag.repoCount ?? 0,
      depth: tag.depth ?? 1,
    })),
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
      optionRender={(option) => {
        const { label, data } = option as {
          label: ReactNode
          data: { value?: number | string; repoCount?: number; depth?: number }
        }
        const optionValue = data?.value ?? option.value
        if (
          typeof optionValue === "string" &&
          optionValue.startsWith(CREATE_PREFIX)
        ) {
          return <span>{label}</span>
        }
        // 子标签按层级缩进，一眼看出归属（与筛选下拉样式一致）
        const indent = Math.max((data?.depth ?? 1) - 1, 0) * 12
        return (
          <span className="flex items-center justify-between gap-3">
            <span style={{ paddingLeft: indent }}>{label}</span>
            <span className="text-xs opacity-60">{data?.repoCount ?? 0}</span>
          </span>
        )
      }}
      onChange={(next) => {
        const tagIds: number[] = []
        const newTagNames: string[] = []
        for (const item of next as (number | string)[]) {
          if (typeof item === "number") {
            tagIds.push(item)
          } else if (item.startsWith(CREATE_PREFIX)) {
            newTagNames.push(item.slice(CREATE_PREFIX.length))
          }
        }
        onChange(tagIds, newTagNames)
      }}
    />
  )
}
