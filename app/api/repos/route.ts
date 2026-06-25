import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import {
  listRepos,
  listDistinctLanguages,
  type ListReposParams,
} from "@/lib/db/repos"

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const source = sp.get("source")
  if (source !== "owned" && source !== "starred") {
    return NextResponse.json(
      { error: "source 参数必须是 owned 或 starred" },
      { status: 400 },
    )
  }

  const tagIdParam = sp.get("tagId")
  const params: ListReposParams = {
    source,
    search: sp.get("search") ?? undefined,
    searchDescription: sp.get("searchDescription") !== "false",
    type: (sp.get("type") as ListReposParams["type"]) ?? "all",
    language: sp.get("language") ?? undefined,
    sort: (sp.get("sort") as ListReposParams["sort"]) ?? "updated",
    favorite: (sp.get("favorite") as ListReposParams["favorite"]) ?? "all",
    note: (sp.get("note") as ListReposParams["note"]) ?? "all",
    tagId:
      tagIdParam === "untagged"
        ? "untagged"
        : tagIdParam
          ? Number(tagIdParam)
          : undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    perPage: sp.get("perPage") ? Number(sp.get("perPage")) : undefined,
  }

  const result = listRepos(db, params)
  const languages = listDistinctLanguages(db, source)
  return NextResponse.json({ ...result, languages })
}
