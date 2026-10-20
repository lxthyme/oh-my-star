import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { setGistFavorite } from "@/lib/db/gist-user-data"
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
  if (typeof body.isFavorite !== "boolean") {
    return NextResponse.json(
      { error: "isFavorite 必须是 boolean" },
      { status: 400 },
    )
  }

  try {
    await setGistFavorite(db, session.userId, id, body.isFavorite)
    return NextResponse.json({ id, isFavorite: body.isFavorite })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
