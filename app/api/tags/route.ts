import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { listTags, createTag } from "@/lib/db/tags"

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  return NextResponse.json({ tags: await listTags(db, session.userId) })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const body = await request.json()
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 })
  }

  const tag = await createTag(db, session.userId, body.name.trim())
  return NextResponse.json(tag, { status: 201 })
}
