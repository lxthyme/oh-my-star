import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import type { Session } from "next-auth"
import type { JWT } from "next-auth/jwt"
import { isAllowedGitHubLogin } from "./lib/auth/allowlist"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      // gist 作用域是读写 Gist（列表 / star / unstar）必需的
      authorization: { params: { scope: "read:user user:email repo gist" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      return isAllowedGitHubLogin(
        (profile as { login?: string } | undefined)?.login,
        process.env.ALLOWED_GITHUB_LOGINS,
      )
    },
    async jwt({ token, account, profile }: { token: JWT; account?: any; profile?: any }) {
      if (account && profile) {
        token.accessToken = account.access_token
        token.githubId = (profile.id as unknown) as number
      }
      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      session.accessToken = token.accessToken!
      session.userId = token.githubId!
      return session
    },
  },
})
