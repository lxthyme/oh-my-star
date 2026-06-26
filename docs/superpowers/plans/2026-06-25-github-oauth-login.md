# GitHub OAuth 登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 GitHub OAuth 登录替换 `.env.local` 里的静态 `GITHUB_TOKEN`，仅允许白名单中的 GitHub 账号访问本应用，并用登录后拿到的 access token 调用 GitHub API。

**Architecture:** 用 Auth.js（`next-auth@beta`，v5）接入 GitHub Provider，JWT session 策略（不引入数据库 session adapter）。`signIn` 回调校验白名单；`jwt`/`session` 回调把 access token 与 GitHub 数字 id 暴露到 session。`proxy.ts`（本项目 Next.js 16 把 `middleware.ts` 重命名为 `proxy.ts`，文件级约定，不是改名）拦截未登录访问并跳转 `/login`。

**Tech Stack:** `next-auth@5.0.0-beta.31`（已确认兼容 `next@^16`、`react@^19`），Next.js 16 App Router，`proxy.ts` 文件约定（非 `middleware.ts`）。

## Global Constraints

- 本项目这版 Next.js 与训练数据存在重大差异（见 `AGENTS.md`），所有 Next.js 用法以 `node_modules/next/dist/docs/` 为准；本计划已核实：本版本 `middleware.ts` 已重命名为 `proxy.ts`，默认导出函数（或具名导出 `proxy`），默认 Node.js 运行时（不再有 Edge Runtime 限制问题）。
- 所有文字输出、注释、提交信息使用简体中文；代码标识符使用英文。
- 默认不写注释；只在隐藏约束处加一行说明。
- 本计划范围只做"认证 + 访问控制 + token 来源切换"，**不**涉及数据库 schema 改动（那是另一份计划 `docs/superpowers/plans/2026-06-25-turso-multitenant-db-migration.md` 的范围）。本计划完成后，`lib/db/*` 仍是原来的单表 SQLite 结构，但所有路由已经过登录保护，调 GitHub API 用的是登录用户自己的 token。

---

## Prerequisites（人工操作，非代码任务）

以下步骤需要你（用户）在浏览器里手动完成，无法由 Claude 代执行：

1. **创建 GitHub OAuth App**：访问 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App。
   - Homepage URL：本地开发先填 `http://localhost:6602`（即 `npm run dev` 端口）。
   - Authorization callback URL：`http://localhost:6602/api/auth/callback/github`。
   - 创建后拿到 `Client ID`，点 "Generate a new client secret" 拿到 `Client Secret`。
   - 部署到 Vercel 后需要再建一个（或编辑现有）OAuth App，把 callback URL 换成生产域名，例如 `https://your-domain.vercel.app/api/auth/callback/github`（GitHub OAuth App 只支持一个回调地址，开发/生产建议建两个独立 OAuth App）。
2. **生成 `AUTH_SECRET`**：终端运行 `openssl rand -base64 32`，复制输出。
3. **把以下变量写入 `.env.local`**（本计划的 Task 1 会读取它们，但写入动作由你完成，避免密钥出现在对话记录里）：
   ```
   AUTH_SECRET=<上面生成的值>
   AUTH_GITHUB_ID=<OAuth App 的 Client ID>
   AUTH_GITHUB_SECRET=<OAuth App 的 Client Secret>
   ALLOWED_GITHUB_LOGINS=<你的 GitHub 用户名，逗号分隔，例如 octocat>
   ```

完成以上步骤后才能进行 Task 6（端到端登录验证）。Task 1-5 中的单元测试与类型检查不依赖真实 OAuth 凭据。

---

### Task 1: 安装并配置 Auth.js 基础设施

**Files:**
- Modify: `package.json`（新增依赖）
- Create: `auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/auth/types.d.ts`

**Interfaces:**
- Produces: `auth.ts` 导出 `{ handlers, auth, signIn, signOut }`（Auth.js v5 标准导出），后续所有任务通过 `import { auth } from "@/auth"` 使用。

- [x] **Step 1: 安装依赖**

Run: `npm install next-auth@beta`

Expected: `package.json` 的 `dependencies` 出现 `"next-auth": "^5.0.0-beta.xx"`。

- [x] **Step 2: 创建最小 Auth.js 配置（暂不加白名单/token 回调，留给 Task 2、Task 3）**

Create `auth.ts`:

```ts
import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
})
```

- [x] **Step 3: 创建 Auth.js 的 Route Handler**

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth"

export const { GET, POST } = handlers
```

- [x] **Step 4: 创建 Session 类型占位文件（Task 3 会补充字段，这里先建立文件防止后续任务找不到扩展点）**

Create `lib/auth/types.d.ts`:

```ts
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session extends DefaultSession {}
}

declare module "next-auth/jwt" {
  interface JWT {}
}
```

- [x] **Step 5: 类型检查确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无输出（无错误）。

- [x] **Step 6: 提交**

```bash
git add package.json package-lock.json auth.ts "app/api/auth/[...nextauth]/route.ts" lib/auth/types.d.ts
git commit -m "$(cat <<'EOF'
feat: 接入 Auth.js 基础配置（GitHub Provider + JWT session）

EOF
)"
```

---

### Task 2: 白名单校验逻辑（含单元测试）

**Files:**
- Create: `lib/auth/allowlist.ts`
- Test: `lib/auth/allowlist.test.ts`
- Modify: `auth.ts`

**Interfaces:**
- Produces: `isAllowedGitHubLogin(login: string | null | undefined, allowlist: string | undefined): boolean`，供 `auth.ts` 的 `signIn` 回调调用。

- [x] **Step 1: 写失败的测试**

Create `lib/auth/allowlist.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isAllowedGitHubLogin } from "./allowlist"

describe("isAllowedGitHubLogin", () => {
  it("allows a login present in the comma-separated allowlist", () => {
    expect(isAllowedGitHubLogin("octocat", "octocat,other-user")).toBe(true)
  })

  it("rejects a login not present in the allowlist", () => {
    expect(isAllowedGitHubLogin("stranger", "octocat,other-user")).toBe(false)
  })

  it("trims whitespace around allowlist entries", () => {
    expect(isAllowedGitHubLogin("octocat", " octocat , other-user ")).toBe(
      true,
    )
  })

  it("rejects when login is null, undefined, or empty", () => {
    expect(isAllowedGitHubLogin(null, "octocat")).toBe(false)
    expect(isAllowedGitHubLogin(undefined, "octocat")).toBe(false)
    expect(isAllowedGitHubLogin("", "octocat")).toBe(false)
  })

  it("rejects everything when allowlist is unset", () => {
    expect(isAllowedGitHubLogin("octocat", undefined)).toBe(false)
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/auth/allowlist.test.ts`
Expected: FAIL，报错 `Cannot find module './allowlist'` 或类似（文件不存在）。

- [x] **Step 3: 实现**

Create `lib/auth/allowlist.ts`:

```ts
export function isAllowedGitHubLogin(
  login: string | null | undefined,
  allowlist: string | undefined,
): boolean {
  if (!login) return false
  const allowed = (allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return allowed.includes(login)
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/auth/allowlist.test.ts`
Expected: 5 个测试全部 PASS。

- [x] **Step 5: 接入 `auth.ts` 的 `signIn` 回调**

Modify `auth.ts`:

```ts
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
```

- [x] **Step 6: 提交**

```bash
git add lib/auth/allowlist.ts lib/auth/allowlist.test.ts auth.ts
git commit -m "$(cat <<'EOF'
feat: GitHub 登录白名单校验

EOF
)"
```

---

### Task 3: 把 access token 与 GitHub 数字 id 暴露到 session

**Files:**
- Modify: `auth.ts`
- Modify: `lib/auth/types.d.ts`

**Interfaces:**
- Produces: `session.accessToken: string`、`session.userId: number`（登录用户的 GitHub 数字 id），后续 Task 6 及未来的多租户计划据此调 GitHub API / 写数据库。

- [x] **Step 1: 扩展 Session/JWT 类型**

Modify `lib/auth/types.d.ts`:

```ts
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
```

- [x] **Step 2: 在 `jwt`/`session` 回调中写入这两个字段**

Modify `auth.ts`（在 `callbacks` 对象内，`signIn` 之后追加）：

```ts
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.accessToken = account.access_token
        token.githubId = profile.id as number
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      session.userId = token.githubId as number
      return session
    },
```

- [x] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（无错误）。

- [x] **Step 4: 提交**

```bash
git add auth.ts lib/auth/types.d.ts
git commit -m "$(cat <<'EOF'
feat: session 暴露 GitHub access token 与数字 id

EOF
)"
```

---

### Task 4: `proxy.ts` 拦截未登录访问

**Files:**
- Create: `proxy.ts`

**Interfaces:**
- Consumes: `auth` from `auth.ts`（Task 1 produced）。

> 本项目这版 Next.js（16）已将 `middleware.ts` 文件约定重命名为 `proxy.ts`，默认 Node.js 运行时，导出函数可以是默认导出或具名导出 `proxy`（详见 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`）。`matcher` 不排除 `/api`，意味着未登录的直接 API 调用也会被重定向（而不是返回 401 JSON）——对个人工具这是可接受的简化，真正需要凭据值的两个路由（Task 6）会在内部再做一次显式校验。

- [x] **Step 1: 创建 `proxy.ts`**

Create `proxy.ts`:

```ts
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
```

- [x] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（无错误）。

- [x] **Step 3: 手动验证（需要 Prerequisites 中的真实 OAuth 凭据已写入 `.env.local`）**

Run: `npm run dev`，浏览器访问 `http://localhost:6602/`。
Expected: 未登录状态下自动跳转到 `http://localhost:6602/login`。

- [x] **Step 4: 提交**

```bash
git add proxy.ts
git commit -m "$(cat <<'EOF'
feat: proxy 拦截未登录访问并跳转登录页

EOF
)"
```

---

### Task 5: 登录页 UI

**Files:**
- Create: `app/login/page.tsx`

**Interfaces:**
- Consumes: `signIn` from `auth.ts`（Task 1 produced）。

- [x] **Step 1: 创建登录页**

Create `app/login/page.tsx`:

```tsx
import { Button, Card, Flex, Typography } from "antd"
import { GithubOutlined } from "@ant-design/icons"
import { signIn } from "@/auth"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <Flex justify="center" style={{ paddingTop: 96 }}>
      <Card style={{ width: 360, textAlign: "center" }}>
        <Typography.Title level={4}>登录</Typography.Title>
        <Typography.Paragraph type="secondary">
          仅限授权的 GitHub 账号访问
        </Typography.Paragraph>
        {error && (
          <Typography.Paragraph type="danger">
            登录失败：该 GitHub 账号未被授权
          </Typography.Paragraph>
        )}
        <form
          action={async () => {
            "use server"
            await signIn("github", { redirectTo: "/" })
          }}
        >
          <Button
            type="primary"
            icon={<GithubOutlined />}
            htmlType="submit"
            block
          >
            用 GitHub 登录
          </Button>
        </form>
      </Card>
    </Flex>
  )
}
```

- [x] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（无错误）。

- [x] **Step 3: 手动验证**

Run: `npm run dev`，浏览器访问 `http://localhost:6602/login`，点击"用 GitHub 登录"。
Expected: 跳转到 GitHub 授权页；授权后，若你的 GitHub 用户名在 `ALLOWED_GITHUB_LOGINS` 中，跳回首页且不再重定向到 `/login`；若不在白名单中，跳回 `/login?error=AccessDenied` 并显示错误提示。

- [x] **Step 4: 提交**

```bash
git add app/login/page.tsx
git commit -m "$(cat <<'EOF'
feat: 新增登录页

EOF
)"
```

---

### Task 6: 同步与 star 路由改用登录用户的 access token

**Files:**
- Modify: `app/api/sync/route.ts`
- Modify: `app/api/repos/[id]/star/route.ts`

**Interfaces:**
- Consumes: `auth` from `auth.ts`；`session.accessToken`（Task 3 produced）。

- [x] **Step 1: 修改 `app/api/sync/route.ts` 的 `POST`，去掉 `process.env.GITHUB_TOKEN`**

Modify `app/api/sync/route.ts`：

```ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { syncRepos, getLastSyncedAt } from "@/lib/db/sync"
import {
  createGitHubClient,
  listOwnedRepos,
  listStarredRepos,
} from "@/lib/github"

export async function GET() {
  return NextResponse.json({ lastSyncedAt: getLastSyncedAt(db) })
}

export async function POST() {
  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const client = createGitHubClient(session.accessToken)

  try {
    const [owned, starred] = await Promise.all([
      listOwnedRepos(client),
      listStarredRepos(client),
    ])
    const result = syncRepos(db, { owned, starred })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      return NextResponse.json(
        { error: "GitHub 授权已失效，请重新登录" },
        { status: 401 },
      )
    }
    if (status === 403) {
      return NextResponse.json(
        { error: "已达 GitHub API 限流，请稍后重试" },
        { status: 429 },
      )
    }
    return NextResponse.json({ error: "同步失败，请稍后重试" }, { status: 502 })
  }
}
```

- [x] **Step 2: 修改 `app/api/repos/[id]/star/route.ts` 的 `PUT`/`DELETE`**

Modify `app/api/repos/[id]/star/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { repos } from "@/lib/db/schema"
import { setStarred } from "@/lib/db/repos"
import { createGitHubClient, starRepo, unstarRepo } from "@/lib/github"

function getOwnerAndName(
  repoId: number,
): { owner: string; name: string } | null {
  const row = db
    .select({ fullName: repos.fullName })
    .from(repos)
    .where(eq(repos.id, repoId))
    .get()
  if (!row) return null
  const [owner, name] = row.fullName.split("/")
  return { owner, name }
}

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const target = getOwnerAndName(repoId)
  if (!target) {
    return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
  }

  try {
    await starRepo(
      createGitHubClient(session.accessToken),
      target.owner,
      target.name,
    )
    setStarred(db, repoId, true)
    return NextResponse.json({ id: repoId, isStarred: true })
  } catch {
    return NextResponse.json(
      { error: "Star 失败，请稍后重试" },
      { status: 502 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const session = await auth()
  if (!session?.accessToken) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const target = getOwnerAndName(repoId)
  if (!target) {
    return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
  }

  try {
    await unstarRepo(
      createGitHubClient(session.accessToken),
      target.owner,
      target.name,
    )
    setStarred(db, repoId, false)
    return NextResponse.json({ id: repoId, isStarred: false })
  } catch {
    return NextResponse.json(
      { error: "Unstar 失败，请稍后重试" },
      { status: 502 },
    )
  }
}
```

- [x] **Step 3: 全量测试 + 类型检查 + 构建**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全部通过（这两个路由文件没有专属单元测试，现有 `lib/db/*.test.ts`、`lib/github.test.ts` 不受影响应继续全绿；`npm run build` 验证路由文件本身没有编译错误）。

- [x] **Step 4: 手动验证端到端同步**

Run: `npm run dev`，登录后点击页面上的同步按钮。
Expected: 同步成功，不再依赖 `.env.local` 里的 `GITHUB_TOKEN`（可临时删掉该变量验证同步仍然可用）。

- [x] **Step 5: 提交**

```bash
git add app/api/sync/route.ts "app/api/repos/[id]/star/route.ts"
git commit -m "$(cat <<'EOF'
feat: 同步与 star 接口改用登录用户的 GitHub access token

EOF
)"
```

---

## 不在本计划范围内

- 不改 `lib/db/schema.ts` 或任何 `lib/db/*.ts` 的查询逻辑（单表结构不变，多租户 `user_id` 改造见另一份计划）。
- 不给 `repos`/`repos/counts`/`favorite`/`note`/`tags` 等路由加显式 session 检查——这些路由已被 `proxy.ts` 全局保护，显式检查与 `userId` 提取一起在下一份计划的"接入 userId"任务中完成，避免同一批文件被改两次。
- 不做生产环境 OAuth App 的实际注册（Prerequisites 只描述步骤，由用户执行）。
- 不做 GitHub access token 过期后的自动刷新（GitHub OAuth App 的 token 默认不过期，无需 refresh token 流程）。
