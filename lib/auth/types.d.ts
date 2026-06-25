import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session extends DefaultSession {}
}

declare module "next-auth/jwt" {
  interface JWT {}
}
