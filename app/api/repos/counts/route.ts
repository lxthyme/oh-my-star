import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { countReposBySource } from "@/lib/db/repos"

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  return NextResponse.json(await countReposBySource(db, session.userId))
}
