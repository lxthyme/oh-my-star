import { NextResponse } from "next/server"

export function apiErrorResponse(error: unknown, status = 500): NextResponse {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "服务器内部错误"
  return NextResponse.json({ error: message }, { status })
}
