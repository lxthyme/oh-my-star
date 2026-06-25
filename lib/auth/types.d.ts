import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session extends DefaultSession {
    accessToken: string
    userId: number
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string
    githubId?: number
  }
}
