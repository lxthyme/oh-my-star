"use client"

import { Avatar, Button, Card, Space, Tag as AntTag, Typography, theme } from "antd"
import {
  CommentOutlined,
  EyeInvisibleOutlined,
  FileOutlined,
  FileTextOutlined,
  ForkOutlined,
  GlobalOutlined,
  HeartFilled,
  HeartOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons"
import TagSelect, { type TagOption } from "./TagSelect"
import NoteEditor from "./NoteEditor"
import Highlight from "./Highlight"
import { languageColor } from "../lib/language-color"

const { Text, Paragraph, Link } = Typography

export interface GistFile {
  name: string
  language: string | null
  size: number
  preview: string
}

export interface GistCardData {
  id: string
  description: string | null
  htmlUrl: string
  ownerLogin: string
  ownerAvatar: string | null
  public: boolean
  commentsCount: number
  forksCount: number
  stargazersCount: number
  files: GistFile[]
  createdAt: string | null
  updatedAt: string | null
  isStarred: boolean
  isFavorite: boolean
  note: string | null
  tags: TagOption[]
}

interface GistCardProps {
  gist: GistCardData
  allTags: TagOption[]
  keyword?: string
  onToggleFavorite: (id: string, next: boolean) => Promise<void>
  onToggleStar: (id: string, next: boolean) => Promise<void>
  onSaveNote: (id: string, note: string) => Promise<void>
  onChangeTags: (id: string, tagNames: string[]) => Promise<void>
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function GistCard({
  gist,
  allTags,
  keyword,
  onToggleFavorite,
  onToggleStar,
  onSaveNote,
  onChangeTags,
}: GistCardProps) {
  const { token } = theme.useToken()
  const createdAt = formatDateTime(gist.createdAt)
  const updatedAt = formatDateTime(gist.updatedAt)
  const previewFile = gist.files.find((file) => file.preview)

  return (
    <Card size="small" className="repo-card" style={{ height: "100%" }}>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Space
          align="start"
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          <Space size={8} align="start">
            <Avatar size={24} src={gist.ownerAvatar}>
              {gist.ownerLogin.slice(0, 1).toUpperCase()}
            </Avatar>
            <Link
              href={gist.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              strong
            >
              <Highlight text={gist.ownerLogin} keyword={keyword} />
            </Link>
          </Space>
          <Space size={8}>
            <Button
              type="text"
              shape="circle"
              size="small"
              aria-label={gist.isFavorite ? "取消收藏" : "收藏"}
              icon={
                gist.isFavorite ? (
                  <HeartFilled style={{ color: "#eb2f96" }} />
                ) : (
                  <HeartOutlined />
                )
              }
              onClick={() => onToggleFavorite(gist.id, !gist.isFavorite)}
            />
            <Button
              type="text"
              shape="circle"
              size="small"
              aria-label={gist.isStarred ? "取消 Star" : "Star"}
              icon={
                gist.isStarred ? (
                  <StarFilled style={{ color: "#fadb14" }} />
                ) : (
                  <StarOutlined />
                )
              }
              onClick={() => onToggleStar(gist.id, !gist.isStarred)}
            />
            <NoteEditor
              note={gist.note}
              onSave={(note) => onSaveNote(gist.id, note)}
            />
          </Space>
        </Space>

        <Space size={8} wrap>
          {gist.public ? (
            <AntTag icon={<GlobalOutlined />} color="green">
              Public
            </AntTag>
          ) : (
            <AntTag icon={<EyeInvisibleOutlined />} color="orange">
              Secret
            </AntTag>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {gist.id}
          </Text>
        </Space>

        {gist.description && (
          <Link
            href={gist.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ width: "100%" }}
          >
            <Paragraph
              type="secondary"
              ellipsis={{ rows: 2, tooltip: gist.description }}
              style={{ marginBottom: 0 }}
            >
              <Highlight text={gist.description} keyword={keyword} />
            </Paragraph>
          </Link>
        )}

        {previewFile && (
          <pre
            style={{
              width: "100%",
              margin: 0,
              padding: token.paddingXS,
              borderRadius: token.borderRadiusSM,
              background: token.colorFillTertiary,
              border: `1px solid ${token.colorBorderSecondary}`,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.5,
              maxHeight: 160,
              overflow: "auto",
              whiteSpace: "pre",
            }}
          >
            <Highlight text={previewFile.preview} keyword={keyword} />
          </pre>
        )}

        <Space size={12} wrap>
          <Text type="secondary">
            <FileOutlined /> {gist.files.length}{" "}
            {gist.files.length === 1 ? "file" : "files"}
          </Text>
          <Text type="secondary">
            <ForkOutlined /> {gist.forksCount}
          </Text>
          <Text type="secondary">
            <CommentOutlined /> {gist.commentsCount}
          </Text>
          <Text type="secondary">
            <StarOutlined /> {gist.stargazersCount}
          </Text>
          {(createdAt || updatedAt) && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {createdAt ? `创建 ${createdAt}` : null}
              {updatedAt ? ` · 更新 ${updatedAt}` : null}
            </Text>
          )}
        </Space>

        {gist.files.length > 0 && (
          <Space size={[6, 6]} wrap>
            {gist.files.map((file) => (
              <span key={file.name} style={{ display: "inline-flex" }}>
                <AntTag
                  style={{ margin: 0 }}
                  icon={
                    file.language ? (
                      <span
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: languageColor(file.language),
                        }}
                      />
                    ) : null
                  }
                >
                  <Highlight text={file.name} keyword={keyword} />
                  {file.language ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {" "}
                      {file.language}
                    </Text>
                  ) : null}
                </AntTag>
              </span>
            ))}
          </Space>
        )}

        <TagSelect
          allTags={allTags}
          value={gist.tags.map((t) => t.name)}
          onChange={(tagNames) => onChangeTags(gist.id, tagNames)}
        />

        {gist.note && (
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
              ellipsis={{ rows: 2, tooltip: gist.note }}
              style={{ marginBottom: 0 }}
            >
              <FileTextOutlined style={{ marginRight: token.marginXS }} />
              {gist.note}
            </Paragraph>
          </div>
        )}
      </Space>
    </Card>
  )
}
