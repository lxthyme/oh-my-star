"use client"

import { Card, Space, Tag as AntTag, Typography } from "antd"
import { ForkOutlined, HeartFilled, HeartOutlined, StarFilled, StarOutlined } from "@ant-design/icons"
import TagSelect, { type TagOption } from "./TagSelect"
import NoteEditor from "./NoteEditor"

const { Text, Paragraph, Link } = Typography

export interface RepoCardData {
  id: number
  fullName: string
  description: string | null
  htmlUrl: string
  language: string | null
  stargazersCount: number
  forksCount: number
  archived: boolean
  fork: boolean
  isOwned: boolean
  isStarred: boolean
  isFavorite: boolean
  note: string | null
  tags: TagOption[]
}

interface RepoCardProps {
  repo: RepoCardData
  allTags: TagOption[]
  onToggleFavorite: (id: number, next: boolean) => Promise<void>
  onToggleStar: (id: number, next: boolean) => Promise<void>
  onSaveNote: (id: number, note: string) => Promise<void>
  onChangeTags: (id: number, tagNames: string[]) => Promise<void>
}

export default function RepoCard({
  repo,
  allTags,
  onToggleFavorite,
  onToggleStar,
  onSaveNote,
  onChangeTags,
}: RepoCardProps) {
  return (
    <Card size="small" style={{ height: "100%" }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
          <Link href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" strong>
            {repo.fullName}
          </Link>
          <Space size={4}>
            <a onClick={() => onToggleFavorite(repo.id, !repo.isFavorite)}>
              {repo.isFavorite ? <HeartFilled style={{ color: "#eb2f96" }} /> : <HeartOutlined />}
            </a>
            <a onClick={() => onToggleStar(repo.id, !repo.isStarred)}>
              {repo.isStarred ? <StarFilled style={{ color: "#fadb14" }} /> : <StarOutlined />}
            </a>
            <NoteEditor note={repo.note} onSave={(note) => onSaveNote(repo.id, note)} />
          </Space>
        </Space>

        {repo.description && (
          <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
            {repo.description}
          </Paragraph>
        )}

        <Space size={12}>
          {repo.language && <Text type="secondary">{repo.language}</Text>}
          <Text type="secondary">
            <StarOutlined /> {repo.stargazersCount}
          </Text>
          <Text type="secondary">
            <ForkOutlined /> {repo.forksCount}
          </Text>
          {repo.archived && <AntTag>Archived</AntTag>}
          {repo.fork && <AntTag>Fork</AntTag>}
        </Space>

        <TagSelect
          allTags={allTags}
          value={repo.tags.map((t) => t.name)}
          onChange={(tagNames) => onChangeTags(repo.id, tagNames)}
        />
      </Space>
    </Card>
  )
}
