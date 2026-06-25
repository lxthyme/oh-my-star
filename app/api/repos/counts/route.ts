import { NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { countReposBySource } from "@/lib/db/repos"

export async function GET() {
  return NextResponse.json(countReposBySource(db))
}
