import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { setGistNote } from "@/lib/db/gist-user-data"
import { apiErrorResponse } from "@/lib/api-error"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  if (!id.trim()) {
    return NextResponse.json({ error: "id 不能为空" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.note !== "string") {
    return NextResponse.json({ error: "note 必须是字符串" }, { status: 400 })
  }

  try {
    await setGistNote(db, session.userId, id, body.note)
    return NextResponse.json({ id, note: body.note })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
