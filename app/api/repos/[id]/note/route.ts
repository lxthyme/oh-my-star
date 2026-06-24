import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { setNote } from "@/lib/db/user-data"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.note !== "string") {
    return NextResponse.json({ error: "note 必须是字符串" }, { status: 400 })
  }

  setNote(db, repoId, body.note)
  return NextResponse.json({ id: repoId, note: body.note })
}
