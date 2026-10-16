"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Input,
  Segmented,
  Space,
  Spin,
  Typography,
  message,
  theme,
} from "antd"
import { ArrowLeftOutlined, SearchOutlined } from "@ant-design/icons"
import dynamic from "next/dynamic"
import { fetchJson } from "../lib/api-client"
import type { TagTreeNode } from "./TagTreeChart"

const { Text, Paragraph } = Typography

const TagTreeChart = dynamic(() => import("./TagTreeChart"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <Spin />
    </div>
  ),
})

type DepthMode = "-1" | "1" | "2"

export default function TagTreePage() {
  const { token } = theme.useToken()
  const [tags, setTags] = useState<TagTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [keyword, setKeyword] = useState("")
  const [depthMode, setDepthMode] = useState<DepthMode>("2")
  const [orient, setOrient] = useState<"LR" | "TB">("LR")

  const fetchTags = useCallback(async () => {
    setLoading(true)
    try {
      const json = await fetchJson<{ tags: TagTreeNode[] }>("/api/tags")
      setTags(json.tags)
    } catch (error) {
      message.error(
        error instanceof Error
          ? `获取标签失败: ${error.message}`
          : "获取标签失败",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags()
  }, [fetchTags])

  const matchedId = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return null
    const hit = tags.find((tag) => tag.path.toLowerCase().includes(kw))
    return hit?.id ?? null
  }, [keyword, tags])

  // 搜索命中时直接定位到该标签并全部展开，保证看得见
  const effectiveSelectedId = matchedId ?? selectedId
  const effectiveDepth = matchedId !== null ? -1 : Number(depthMode)

  const selected = useMemo(
    () => tags.find((tag) => tag.id === effectiveSelectedId) ?? null,
    [tags, effectiveSelectedId],
  )
  const children = useMemo(
    () => (selected ? tags.filter((tag) => tag.parentId === selected.id) : []),
    [tags, selected],
  )
  const hasHierarchy = useMemo(
    () => tags.some((tag) => tag.parentId !== null),
    [tags],
  )

  const detailPanel = (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 16,
        alignSelf: "flex-start",
      }}
    >
      {selected ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Text strong style={{ fontSize: 16 }}>
              {selected.name}
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {selected.path}
              </Text>
            </div>
          </div>
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label="自身仓库">
              {selected.repoCount}
            </Descriptions.Item>
            <Descriptions.Item label="含子级仓库">
              {selected.totalRepoCount}
            </Descriptions.Item>
            <Descriptions.Item label="子标签">
              {selected.childrenCount}
            </Descriptions.Item>
          </Descriptions>
          {selected.description && (
            <Paragraph style={{ margin: 0 }} type="secondary">
              {selected.description}
            </Paragraph>
          )}
          {children.length > 0 && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                子标签
              </Text>
              <div style={{ marginTop: 4 }}>
                <Space size={[4, 4]} wrap>
                  {children.map((child) => (
                    <Button
                      key={child.id}
                      size="small"
                      type={child.id === selectedId ? "primary" : "default"}
                      onClick={() => setSelectedId(child.id)}
                    >
                      {child.name} · {child.totalRepoCount}
                    </Button>
                  ))}
                </Space>
              </div>
            </div>
          )}
          {selected.role === "orphan" && (
            <Alert
              type="info"
              showIcon
              message="父标签被删除后，子标签会先移到这里，可手动调整归属；该标签本身不支持删除。"
            />
          )}
          <Space wrap>
            <Link href={`/repos?tag=${selected.id}`}>
              <Button size="small">查看我的仓库</Button>
            </Link>
            <Link href={`/stars?tag=${selected.id}`}>
              <Button size="small">查看 Stars</Button>
            </Link>
          </Space>
        </Space>
      ) : (
        <Text type="secondary">
          {tags.length === 0 ? "还没有标签" : "点击节点查看标签详情"}
        </Text>
      )}
    </div>
  )

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <Link href="/tags">
          <Button icon={<ArrowLeftOutlined />}>返回标签管理</Button>
        </Link>
        <Text strong style={{ fontSize: 16 }}>
          标签层级图
        </Text>
        <Text type="secondary">共 {tags.length} 个标签</Text>
        <Input
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="搜索标签并定位"
          style={{ width: 200 }}
        />
        <Segmented
          value={depthMode}
          onChange={(value) => setDepthMode(value as DepthMode)}
          options={[
            { label: "收起", value: "1" },
            { label: "两层", value: "2" },
            { label: "全部展开", value: "-1" },
          ]}
        />
        <Segmented
          value={orient}
          onChange={(value) => setOrient(value as "LR" | "TB")}
          options={[
            { label: "横向", value: "LR" },
            { label: "纵向", value: "TB" },
          ]}
        />
      </div>

      <Spin spinning={loading}>
        {!loading && tags.length === 0 ? (
          <Empty
            style={{ margin: "80px 0" }}
            description="还没有标签，先去标签管理新建一个吧"
          />
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: "calc(100vh - 260px)",
                minHeight: 420,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                overflow: "hidden",
              }}
            >
              {!loading && (
                <TagTreeChart
                  tags={tags}
                  selectedId={effectiveSelectedId}
                  initialTreeDepth={effectiveDepth}
                  focusId={matchedId}
                  orient={orient}
                  onSelect={setSelectedId}
                />
              )}
            </div>
            {detailPanel}
          </div>
        )}
      </Spin>

      {!loading && tags.length > 0 && !hasHierarchy && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="所有标签都是顶级标签"
          description="在标签管理里编辑标签并指定父标签后，这里就会显示层级结构。"
        />
      )}
    </div>
  )
}
