"use client"

import { useState } from "react"
import { Button, Input, Popover } from "antd"
import { EditOutlined, FileTextOutlined } from "@ant-design/icons"

interface NoteEditorProps {
  note: string | null
  onSave: (note: string) => Promise<void>
}

export default function NoteEditor({ note, onSave }: NoteEditorProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(note ?? "")
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(note ?? "")
    setOpen(next)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger="click"
      content={
        <div style={{ width: 280 }}>
          <Input.TextArea
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="添加备注..."
          />
          <Button
            type="primary"
            size="small"
            style={{ marginTop: 8 }}
            loading={saving}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>
      }
    >
      <Button
        type="text"
        size="small"
        aria-label={note ? "编辑备注" : "添加备注"}
        icon={
          note ? (
            <FileTextOutlined style={{ color: "#1677ff" }} />
          ) : (
            <EditOutlined />
          )
        }
      />
    </Popover>
  )
}
