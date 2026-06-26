import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { setFavorite } from "@/lib/db/user-data"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.isFavorite !== "boolean") {
    return NextResponse.json(
      { error: "isFavorite 必须是 boolean" },
      { status: 400 },
    )
  }

  await setFavorite(db, session.userId, repoId, body.isFavorite)
  return NextResponse.json({ id: repoId, isFavorite: body.isFavorite })
}
