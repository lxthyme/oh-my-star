import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import { isAllowedGitHubLogin } from "./lib/auth/allowlist"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      return isAllowedGitHubLogin(
        (profile as { login?: string } | undefined)?.login,
        process.env.ALLOWED_GITHUB_LOGINS,
      )
    },
  },
})
