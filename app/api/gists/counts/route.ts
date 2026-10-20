import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { countGistsBySource } from "@/lib/db/gists"
import { apiErrorResponse } from "@/lib/api-error"

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  try {
    return NextResponse.json(await countGistsBySource(db, session.userId))
  } catch (error) {
    return apiErrorResponse(error)
  }
}
