import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { listTags, createTag } from "@/lib/db/tags"

export async function GET() {
  return NextResponse.json({ tags: listTags(db) })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 })
  }

  const tag = createTag(db, body.name.trim())
  return NextResponse.json(tag, { status: 201 })
}
