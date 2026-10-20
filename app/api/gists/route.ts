import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { listGists, type ListGistsParams } from "@/lib/db/gists"
import { apiErrorResponse } from "@/lib/api-error"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const source = sp.get("source")
  if (source !== "owned" && source !== "starred") {
    return NextResponse.json(
      { error: "source 参数必须是 owned 或 starred" },
      { status: 400 },
    )
  }

  const tagIdParam = sp.get("tagId")
  const params: ListGistsParams = {
    source,
    search: sp.get("search") ?? undefined,
    type: (sp.get("type") as ListGistsParams["type"]) ?? "all",
    sort: (sp.get("sort") as ListGistsParams["sort"]) ?? "created",
    favorite: (sp.get("favorite") as ListGistsParams["favorite"]) ?? "all",
    note: (sp.get("note") as ListGistsParams["note"]) ?? "all",
    tagId:
      tagIdParam === "untagged"
        ? "untagged"
        : tagIdParam
          ? Number(tagIdParam)
          : undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    perPage: sp.get("perPage") ? Number(sp.get("perPage")) : undefined,
  }

  try {
    return NextResponse.json(await listGists(db, session.userId, params))
  } catch (error) {
    return apiErrorResponse(error)
  }
}
