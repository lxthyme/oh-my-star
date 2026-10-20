"use client"

import { Button, Card, Space, Tag as AntTag, Typography, theme } from "antd"
import {
  FileTextOutlined,
  ForkOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons"
import TagSelect, { type TagOption } from "./TagSelect"
import NoteEditor from "./NoteEditor"
import Highlight from "./Highlight"
import { languageColor } from "../lib/language-color"

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
  private: boolean
  isTemplate: boolean
  mirror: boolean
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

export default function RepoCard({
  repo,
  allTags,
  keyword,
  onToggleFavorite,
  onToggleStar,
  onSaveNote,
  onChangeTags,
}: RepoCardProps) {
  const { token } = theme.useToken()

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
          {repo.private && (
            <AntTag color="red" icon={<LockOutlined />}>
              Private
            </AntTag>
          )}
          {repo.archived && <AntTag color="warning">Archived</AntTag>}
          {repo.fork && <AntTag color="processing">Fork</AntTag>}
          {repo.isTemplate && <AntTag color="purple">Template</AntTag>}
          {repo.mirror && <AntTag color="gold">Mirror</AntTag>}
        </Space>

        <TagSelect
          allTags={allTags}
          value={repo.tags.map((t) => t.name)}
          onChange={(tagNames) => onChangeTags(repo.id, tagNames)}
        />

        {repo.note && (
          <div
            style={{
              width: "100%",
              padding: `${token.paddingXXS}px ${token.paddingXS}px`,
              borderRadius: token.borderRadiusSM,
              background: token.colorFillTertiary,
            }}
          >
            <Paragraph
              type="secondary"
              ellipsis={{ rows: 2, tooltip: repo.note }}
              style={{ marginBottom: 0 }}
            >
              <FileTextOutlined style={{ marginRight: token.marginXS }} />
              {repo.note}
            </Paragraph>
          </div>
        )}
      </Space>
    </Card>
  )
}
