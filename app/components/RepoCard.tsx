"use client"

import { Button, Card, Space, Tag as AntTag, Typography } from "antd"
import {
  ForkOutlined,
  HeartFilled,
  HeartOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons"
import TagSelect, { type TagOption } from "./TagSelect"
import NoteEditor from "./NoteEditor"

const { Text, Paragraph, Link } = Typography

function Highlight({ text, keyword }: { text: string; keyword?: string }) {
  if (!keyword) return <>{text}</>
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "gi"))
  const lower = keyword.toLowerCase()
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower ? (
          <Text key={i} mark style={{ padding: 0 }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  )
}

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
  keyword?: string
  onToggleFavorite: (id: number, next: boolean) => Promise<void>
  onToggleStar: (id: number, next: boolean) => Promise<void>
  onSaveNote: (id: number, note: string) => Promise<void>
  onChangeTags: (id: number, tagNames: string[]) => Promise<void>
}

function languageColor(language: string) {
  let hash = 0
  for (let i = 0; i < language.length; i++) {
    hash = (hash << 5) - hash + language.charCodeAt(i)
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 50%)`
}

export default function RepoCard({
  repo,
  allTags,
  keyword,
  onToggleFavorite,
  onToggleStar,
  onSaveNote,
  onChangeTags,
}: RepoCardProps) {
  return (
    <Card size="small" className="repo-card" style={{ height: "100%" }}>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Space
          align="start"
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          <Link
            href={repo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            strong
          >
            <Highlight text={repo.fullName} keyword={keyword} />
          </Link>
          <Space size={8}>
            <Button
              type="text"
              shape="circle"
              size="small"
              aria-label={repo.isFavorite ? "取消收藏" : "收藏"}
              icon={
                repo.isFavorite ? (
                  <HeartFilled style={{ color: "#eb2f96" }} />
                ) : (
                  <HeartOutlined />
                )
              }
              onClick={() => onToggleFavorite(repo.id, !repo.isFavorite)}
            />
            <Button
              type="text"
              shape="circle"
              size="small"
              aria-label={repo.isStarred ? "取消 Star" : "Star"}
              icon={
                repo.isStarred ? (
                  <StarFilled style={{ color: "#fadb14" }} />
                ) : (
                  <StarOutlined />
                )
              }
              onClick={() => onToggleStar(repo.id, !repo.isStarred)}
            />
            <NoteEditor
              note={repo.note}
              onSave={(note) => onSaveNote(repo.id, note)}
            />
          </Space>
        </Space>

        {repo.description && (
          <Paragraph
            type="secondary"
            ellipsis={{ rows: 2, tooltip: repo.description }}
            style={{ marginBottom: 0 }}
          >
            <Highlight text={repo.description} keyword={keyword} />
          </Paragraph>
        )}

        <Space size={12} wrap>
          {repo.language && (
            <Text type="secondary">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: languageColor(repo.language),
                  marginRight: 6,
                }}
              />
              {repo.language}
            </Text>
          )}
          <Text type="secondary">
            <StarOutlined /> {repo.stargazersCount}
          </Text>
          <Text type="secondary">
            <ForkOutlined /> {repo.forksCount}
          </Text>
          {repo.archived && <AntTag color="warning">Archived</AntTag>}
          {repo.fork && <AntTag color="processing">Fork</AntTag>}
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
