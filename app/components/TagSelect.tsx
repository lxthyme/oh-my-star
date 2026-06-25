"use client"

import { Select } from "antd"

export interface TagOption {
  id: number
  name: string
}

interface TagSelectProps {
  allTags: TagOption[]
  value: string[]
  onChange: (tagNames: string[]) => void
}

export default function TagSelect({
  allTags,
  value,
  onChange,
}: TagSelectProps) {
  return (
    <Select
      mode="tags"
      size="small"
      style={{ minWidth: 160 }}
      placeholder="添加标签"
      value={value}
      options={allTags.map((tag) => ({ label: tag.name, value: tag.name }))}
      onChange={(next) => onChange(next as string[])}
    />
  )
}
