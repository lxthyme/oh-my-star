import { NextResponse } from "next/server"
import { auth } from "./auth"

const PUBLIC_PATHS = ["/login"]

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isPublic =
    PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/api/auth")

  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url))
  }
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
