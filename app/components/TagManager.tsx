"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag as AntTag,
  Tooltip,
  Typography,
  theme,
} from "antd"
import {
  ApartmentOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons"
import Link from "next/link"
import type { ColumnsType } from "antd/es/table"
import { fetchJson, parseJsonResponse } from "../lib/api-client"
import {
  ORPHAN_TAG_NAME,
  TAG_DESCRIPTION_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
} from "@/lib/tag-limits"

const { Text, Paragraph } = Typography

interface TagRow {
  id: number
  name: string
  description: string | null
  repoCount: number
  role: "orphan" | null
  parentId: number | null
  depth: number
  path: string
  childrenCount: number
  totalRepoCount: number
}

interface TagFormValues {
  name: string
  description: string
  parentId?: number | null
}

/** 树形表格里的节点类型，比 TagRow 多一个 children 字段 */
type TagTreeNode = TagRow & { children?: TagTreeNode[] }

/**
 * 把扁平标签列表组装成树，并按关键字过滤。
 * - 节点自身匹配，或任意后代匹配，节点都保留
 * - 同级按名称排序
 * - 没有匹配到任何节点的子树不会出现在结果里
 */
function buildTagTree(tags: TagRow[], keyword: string): TagTreeNode[] {
  const kw = keyword.trim().toLowerCase()
  const selfMatch = (t: TagRow) =>
    !kw ||
    t.name.toLowerCase().includes(kw) ||
    (t.description ?? "").toLowerCase().includes(kw)

  const byParent = new Map<number | null, TagRow[]>()
  for (const tag of tags) {
    const key = tag.parentId
    const list = byParent.get(key) ?? []
    list.push(tag)
    byParent.set(key, list)
  }

  const build = (parentId: number | null): TagTreeNode[] => {
    const children = byParent.get(parentId) ?? []
    const result: TagTreeNode[] = []
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const grandchildren = build(child.id)
      if (!selfMatch(child) && grandchildren.length === 0) continue
      // 叶子节点不带 children，避免 antd 树表为它们渲染展开按钮
      result.push(
        grandchildren.length > 0
          ? { ...child, children: grandchildren }
          : { ...child },
      )
    }
    return result
  }

  return build(null)
}

/** 收集某标签的全部子孙 id（含间接），带自环保护 */
function collectDescendantIds(tags: TagRow[], rootId: number): Set<number> {
  const childrenOf = new Map<number, number[]>()
  for (const tag of tags) {
    if (tag.parentId === null) continue
    const list = childrenOf.get(tag.parentId) ?? []
    list.push(tag.id)
    childrenOf.set(tag.parentId, list)
  }

  const result = new Set<number>()
  const stack = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const child of childrenOf.get(current) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      stack.push(child)
    }
  }
  return result
}

export default function TagManager() {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const [form] = Form.useForm<TagFormValues>()

  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [editing, setEditing] = useState<TagRow | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  // 仓库标签与 Gist 标签是两个命名空间，各自独立管理
  const [scope, setScope] = useState<"repo" | "gist">("repo")

  const entityLabel = scope === "repo" ? "仓库" : "Gist"

  const fetchTags = useCallback(async () => {
    setLoading(true)
    try {
      const json = await fetchJson<{ tags: TagRow[] }>(
        scope === "gist" ? "/api/tags?scope=gist" : "/api/tags",
      )
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
  }, [message, scope])

  useEffect(() => {
    // 取数后必然 setState，react-hooks/set-state-in-effect 对所有 fetch-on-mount 都会报错
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags()
  }, [fetchTags])

  useEffect(() => {
    if (!modalOpen) return
    form.setFieldsValue({
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      parentId: editing?.parentId ?? null,
    })
  }, [modalOpen, editing, form])

  const visibleTags = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return tags
    return tags.filter((tag) =>
      [tag.name, tag.description ?? ""].some((field) =>
        field.toLowerCase().includes(kw),
      ),
    )
  }, [tags, keyword])

  // 树形表格：扁平过滤后再组装成父子结构；搜索时保留命中节点的祖先链
  const tagTree = useMemo(
    () => buildTagTree(visibleTags, keyword),
    [visibleTags, keyword],
  )

  // 专用标签可以被改名，文案里要显示它的当前名称
  const orphanTagName = useMemo(
    () => tags.find((tag) => tag.role === "orphan")?.name ?? ORPHAN_TAG_NAME,
    [tags],
  )

  // 父级候选：不能是自己，也不能是自己的子孙
  const parentOptions = useMemo(() => {
    const excluded = editing ? collectDescendantIds(tags, editing.id) : null
    return tags
      .filter(
        (tag) => !editing || (tag.id !== editing.id && !excluded!.has(tag.id)),
      )
      .map((tag) => ({ label: tag.path, value: tag.id }))
  }, [tags, editing])

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (tag: TagRow) => {
    setEditing(tag)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
  }

  const callAndRefresh = async (
    path: string,
    method: string,
    body?: unknown,
  ): Promise<boolean> => {
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) await parseJsonResponse(res)
      return true
    } catch (error) {
      message.error(
        error instanceof Error ? `操作失败: ${error.message}` : "操作失败",
      )
      return false
    }
  }

  const handleSubmit = async () => {
    let values: TagFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() ?? "",
      parentId: values.parentId ?? null,
      scope,
    }
    setSubmitting(true)
    const ok = editing
      ? await callAndRefresh(`/api/tags/${editing.id}`, "PATCH", payload)
      : await callAndRefresh("/api/tags", "POST", payload)
    setSubmitting(false)

    if (!ok) return
    message.success(editing ? "标签已更新" : "标签已创建")
    closeModal()
    await fetchTags()
  }

  const handleDelete = async (tag: TagRow) => {
    setDeletingId(tag.id)
    const ok = await callAndRefresh(`/api/tags/${tag.id}`, "DELETE")
    setDeletingId(null)
    if (!ok) return
    message.success(
      tag.childrenCount > 0
        ? `已删除标签「${tag.name}」，${tag.childrenCount} 个子标签已移到「${orphanTagName}」`
        : `已删除标签「${tag.name}」`,
    )
    await fetchTags()
  }

  const columns: ColumnsType<TagRow> = [
    {
      title: "标签",
      dataIndex: "name",
      sorter: (a, b) => a.path.localeCompare(b.path),
      render: (_name: string, row) => (
        <AntTag
          color={row.depth > 1 ? "geekblue" : "blue"}
          style={{ margin: 0 }}
        >
          {row.name}
        </AntTag>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      render: (description: string | null) =>
        description ? (
          <Paragraph
            style={{ margin: 0 }}
            ellipsis={{ rows: 2, tooltip: description }}
          >
            {description}
          </Paragraph>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "子标签",
      dataIndex: "childrenCount",
      width: 90,
      align: "right",
      sorter: (a, b) => a.childrenCount - b.childrenCount,
      render: (count: number) =>
        count > 0 ? count : <Text type="secondary">—</Text>,
    },
    {
      title: `${entityLabel}数`,
      dataIndex: "totalRepoCount",
      width: 130,
      align: "right",
      sorter: (a, b) => a.totalRepoCount - b.totalRepoCount,
      render: (total: number, row) =>
        row.childrenCount > 0 ? (
          <Tooltip
            title={`自身 ${row.repoCount} / 含子级 ${row.totalRepoCount}`}
          >
            <span>
              {total}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {" "}
                (自身 {row.repoCount})
              </Text>
            </span>
          </Tooltip>
        ) : (
          total
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_value, tag) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(tag)}
          >
            编辑
          </Button>
          {tag.role === "orphan" ? (
            <Tooltip
              title={`「${tag.name}」是专用标签，不支持删除；请先把它的子标签移到其他标签下。`}
            >
              <Button
                type="link"
                size="small"
                icon={<DeleteOutlined />}
                disabled
              >
                删除
              </Button>
            </Tooltip>
          ) : (
            <Popconfirm
              title={`删除标签「${tag.name}」？`}
              description={[
                tag.totalRepoCount > 0
                  ? `该标签已用于 ${tag.totalRepoCount} 个${entityLabel}，删除后这些${entityLabel}会移除此标签，且无法恢复。`
                  : "删除后无法恢复。",
                tag.childrenCount > 0
                  ? `${tag.childrenCount} 个子标签将移动到「${orphanTagName}」下，之后可手动调整。`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deletingId === tag.id }}
              onConfirm={() => handleDelete(tag)}
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={deletingId === tag.id}
              >
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

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
        <Text strong style={{ fontSize: 16 }}>
          标签管理
        </Text>
        <Segmented
          value={scope}
          onChange={(value) => {
            setScope(value as "repo" | "gist")
            setEditing(null)
            setModalOpen(false)
            setKeyword("")
          }}
          options={[
            { label: "仓库标签", value: "repo" },
            { label: "Gist 标签", value: "gist" },
          ]}
        />
        <Text type="secondary">共 {tags.length} 个标签</Text>
        <Input
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder="搜索标签名称或描述"
          style={{ width: 240 }}
        />
        <Link href="/tags/tree">
          <Button icon={<ApartmentOutlined />}>层级图</Button>
        </Link>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          style={{ marginLeft: "auto" }}
        >
          新建标签
        </Button>
      </div>

      <Spin spinning={loading}>
        {!loading && tagTree.length === 0 ? (
          <Empty
            style={{ margin: "80px 0" }}
            description={
              tags.length === 0 ? "还没有标签，先新建一个吧" : "没有匹配的标签"
            }
          />
        ) : (
          <Table<TagTreeNode>
            rowKey="id"
            columns={columns}
            dataSource={tagTree}
            scroll={{ x: true }}
            pagination={false}
            defaultExpandAllRows
          />
        )}
      </Spin>

      <Modal
        open={modalOpen}
        title={editing ? "编辑标签" : "新建标签"}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={closeModal}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: "请输入标签名称" },
              {
                max: TAG_NAME_MAX_LENGTH,
                message: `最多 ${TAG_NAME_MAX_LENGTH} 个字符`,
              },
            ]}
          >
            <Input
              placeholder="例如：cli-tools"
              maxLength={TAG_NAME_MAX_LENGTH}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea
              rows={3}
              maxLength={TAG_DESCRIPTION_MAX_LENGTH}
              showCount
              placeholder="这个标签用来归类哪些仓库？"
            />
          </Form.Item>
          <Form.Item
            name="parentId"
            label="父标签"
            extra={
              editing?.role === "orphan"
                ? "专用标签不支持变更层级；可以改名称。"
                : "不选择则为顶级标签；选中父标签后，筛选该父标签会一并匹配它的子标签。"
            }
          >
            <Select
              allowClear
              placeholder="顶级标签"
              options={parentOptions}
              optionFilterProp="label"
              showSearch
              disabled={tags.length === 0 || editing?.role === "orphan"}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
