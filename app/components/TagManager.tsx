"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag as AntTag,
  Tooltip,
  Typography,
  message,
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
  const [form] = Form.useForm<TagFormValues>()

  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [editing, setEditing] = useState<TagRow | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const fetchTags = useCallback(async () => {
    setLoading(true)
    try {
      const json = await fetchJson<{ tags: TagRow[] }>("/api/tags")
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
        ? `已删除标签「${tag.name}」，${tag.childrenCount} 个子标签已移到「${ORPHAN_TAG_NAME}」`
        : `已删除标签「${tag.name}」`,
    )
    await fetchTags()
  }

  const columns: ColumnsType<TagRow> = [
    {
      title: "标签",
      dataIndex: "name",
      sorter: (a, b) => a.path.localeCompare(b.path),
      render: (_name: string, row) => {
        const segments = row.path.split(" / ")
        const prefix = segments.slice(0, -1)
        return (
          <Space size={4} wrap={false}>
            {prefix.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {prefix.join(" / ")} /
              </Text>
            )}
            <AntTag
              color={row.depth > 1 ? "geekblue" : "blue"}
              style={{ margin: 0 }}
            >
              {row.name}
            </AntTag>
          </Space>
        )
      },
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
      title: "仓库数",
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
          {tag.name === ORPHAN_TAG_NAME ? (
            <Tooltip
              title={`「${ORPHAN_TAG_NAME}」是专用标签，不支持删除；请先把它的子标签移到其他标签下。`}
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
                  ? `该标签已用于 ${tag.totalRepoCount} 个仓库，删除后这些仓库会移除此标签，且无法恢复。`
                  : "删除后无法恢复。",
                tag.childrenCount > 0
                  ? `${tag.childrenCount} 个子标签将移动到「${ORPHAN_TAG_NAME}」下，之后可手动调整。`
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
        {!loading && visibleTags.length === 0 ? (
          <Empty
            style={{ margin: "80px 0" }}
            description={
              tags.length === 0 ? "还没有标签，先新建一个吧" : "没有匹配的标签"
            }
          />
        ) : (
          <Table<TagRow>
            rowKey="id"
            columns={columns}
            dataSource={visibleTags}
            scroll={{ x: true }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `Total ${total} items`,
            }}
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
            extra="不选择则为顶级标签；选中父标签后，筛选该父标签会一并匹配它的子标签。"
          >
            <Select
              allowClear
              placeholder="顶级标签"
              options={parentOptions}
              optionFilterProp="label"
              showSearch
              disabled={tags.length === 0}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
