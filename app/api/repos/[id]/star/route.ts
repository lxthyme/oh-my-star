import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db/client"
import { repos } from "@/lib/db/schema"
import { setStarred } from "@/lib/db/repos"
import { createGitHubClient, starRepo, unstarRepo } from "@/lib/github"

function getOwnerAndName(repoId: number): { owner: string; name: string } | null {
  const row = db.select({ fullName: repos.fullName }).from(repos).where(eq(repos.id, repoId)).get()
  if (!row) return null
  const [owner, name] = row.fullName.split("/")
  return { owner, name }
}

export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN 未配置" }, { status: 401 })
  }

  const target = getOwnerAndName(repoId)
  if (!target) {
    return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
  }

  try {
    await starRepo(createGitHubClient(token), target.owner, target.name)
    setStarred(db, repoId, true)
    return NextResponse.json({ id: repoId, isStarred: true })
  } catch {
    return NextResponse.json({ error: "Star 失败，请稍后重试" }, { status: 502 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN 未配置" }, { status: 401 })
  }

  const target = getOwnerAndName(repoId)
  if (!target) {
    return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
  }

  try {
    await unstarRepo(createGitHubClient(token), target.owner, target.name)
    setStarred(db, repoId, false)
    return NextResponse.json({ id: repoId, isStarred: false })
  } catch {
    return NextResponse.json({ error: "Unstar 失败，请稍后重试" }, { status: 502 })
  }
}
