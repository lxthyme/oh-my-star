# 顶部主题切换 + 同步按钮迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顶部菜单栏新增三态（亮/暗/跟随系统）主题切换按钮；将同步按钮从 `RepoList` 迁移到顶部菜单并展示上次同步时间（绝对时间格式）。

**Architecture:** 主题：Next.js 16 官方 inline-script 防闪烁方案（`<html data-theme>` + `<head>` 内同步执行的 script），CSS 选择器从 `prefers-color-scheme` 媒体查询改为 `[data-theme]` 属性选择器；React 侧用一个本地 hook（`useThemeMode`）驱动 antd `ConfigProvider` 算法，遵循项目现有的"SSR 默认值 + `useEffect` 中纠正"模式以避免 antd CSS-in-JS 的 hydration mismatch。同步：新增 `SyncContext`（React Context）把同步状态从 `RepoList` 提升到 `AppShell` 头部，`RepoList` 通过 `syncVersion` 依赖触发重新拉取数据，取代原来组件内部状态。

**Tech Stack:** Next.js 16.2.9 (App Router) / React 19 / antd 6 / Drizzle ORM + better-sqlite3 / Vitest（`environment: "node"`，无 jsdom/Testing Library）。

## Global Constraints

- 不引入 `next-themes` 或其他主题第三方依赖，手写三态切换逻辑。
- 不新增 settings/meta 表存储同步时间，复用 `repos.synced_at` 字段的 `MAX()`。
- 上次同步时间用绝对时间格式展示，不做相对时间的定时刷新。
- 项目无 React 组件测试基础设施（vitest `environment: "node"`，无 jsdom/Testing Library），本计划不为此新增测试依赖/配置；纯逻辑（`resolveTheme`、`getLastSyncedAt`）按现有 `lib/**/*.test.ts` 模式做自动化测试，React 组件改动通过最终的手动浏览器验证确认。
- Next.js 16 与训练知识有破坏性变更（见 `AGENTS.md`），本计划涉及 `<head>` inline script 防闪烁的写法已对照 `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` 确认。

---

### Task 1: 上次同步时间 — 数据层 + API

**Files:**
- Modify: `lib/db/sync.ts`
- Modify: `lib/db/sync.test.ts`
- Modify: `app/api/sync/route.ts`

**Interfaces:**
- Produces: `getLastSyncedAt(db: AppDatabase): string | null`（导出自 `lib/db/sync.ts`），`GET /api/sync` → `{ lastSyncedAt: string | null }`。Task 5（`SyncContext`）会调用这个 GET 接口。

- [ ] **Step 1: 写失败的测试**

在 `lib/db/sync.test.ts` 末尾（`describe("syncRepos", ...)` 闭合的 `})` 之后）新增：

```ts
describe("getLastSyncedAt", () => {
  it("returns null when there are no repos", () => {
    const db = createDb(":memory:")
    expect(getLastSyncedAt(db)).toBeNull()
  })

  it("returns the most recent synced_at across all repos", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo({ id: 1 })], starred: [] })
    db.update(repos).set({ syncedAt: "2026-01-01T00:00:00.000Z" }).where(eq(repos.id, 1)).run()

    syncRepos(db, { owned: [makeRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })], starred: [] })
    db.update(repos).set({ syncedAt: "2026-03-01T00:00:00.000Z" }).where(eq(repos.id, 2)).run()

    expect(getLastSyncedAt(db)).toBe("2026-03-01T00:00:00.000Z")
  })
})
```

并把文件顶部的 import 改为：

```ts
import { describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { createDb } from "./client"
import { repos, repoUserData } from "./schema"
import { syncRepos, getLastSyncedAt } from "./sync"
import type { GitHubRepoData } from "../github"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/db/sync.test.ts`
Expected: FAIL —— `getLastSyncedAt` 未定义（`lib/db/sync.ts` 还没导出它）。

- [ ] **Step 3: 实现 `getLastSyncedAt`**

在 `lib/db/sync.ts` 顶部 import 中加入 `sql`：

```ts
import { sql } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos } from "./schema"
import type { GitHubRepoData, StarredRepoData } from "../github"
```

在文件末尾（`syncRepos` 函数之后）新增：

```ts
export function getLastSyncedAt(db: AppDatabase): string | null {
  return db.select({ lastSyncedAt: sql<string | null>`MAX(${repos.syncedAt})` }).from(repos).get()!.lastSyncedAt
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/db/sync.test.ts`
Expected: PASS（全部用例，包括新增的 2 个）。

- [ ] **Step 5: 新增 GET handler**

把 `app/api/sync/route.ts` 改为：

```ts
import { NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { syncRepos, getLastSyncedAt } from "@/lib/db/sync"
import { createGitHubClient, listOwnedRepos, listStarredRepos } from "@/lib/github"

export async function GET() {
  return NextResponse.json({ lastSyncedAt: getLastSyncedAt(db) })
}

export async function POST() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN 未配置，请检查 .env.local" }, { status: 401 })
  }

  const client = createGitHubClient(token)

  try {
    const [owned, starred] = await Promise.all([listOwnedRepos(client), listStarredRepos(client)])
    const result = syncRepos(db, { owned, starred })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401) {
      return NextResponse.json({ error: "GITHUB_TOKEN 无效，请检查 .env.local" }, { status: 401 })
    }
    if (status === 403) {
      return NextResponse.json({ error: "已达 GitHub API 限流，请稍后重试" }, { status: 429 })
    }
    return NextResponse.json({ error: "同步失败，请稍后重试" }, { status: 502 })
  }
}
```

（仅在原文件基础上新增 `GET` 函数和 `getLastSyncedAt` import，`POST` 函数体不变。）

- [ ] **Step 6: 全量跑一次测试确认没有破坏其他用例**

Run: `npx vitest run`
Expected: PASS（全部测试文件）。

- [ ] **Step 7: Commit**

```bash
git add lib/db/sync.ts lib/db/sync.test.ts app/api/sync/route.ts
git commit -m "feat: 新增 GET /api/sync 返回上次同步时间"
```

---

### Task 2: 主题逻辑模块 `app/lib/theme.ts`

**Files:**
- Create: `app/lib/theme.ts`
- Test: `app/lib/theme.test.ts`

**Interfaces:**
- Produces: `type ThemeMode = "light" | "dark" | "system"`，`THEME_STORAGE_KEY: string`，`resolveTheme(mode: ThemeMode, prefersDark: boolean): "light" | "dark"`，`THEME_INLINE_SCRIPT: string`。Task 3（`layout.tsx`）消费 `THEME_INLINE_SCRIPT`；Task 4（`AppShell.tsx`）消费 `ThemeMode`、`THEME_STORAGE_KEY`、`resolveTheme`。

- [ ] **Step 1: 写失败的测试**

创建 `app/lib/theme.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { resolveTheme } from "./theme"

describe("resolveTheme", () => {
  it("returns light when mode is light, regardless of system preference", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("light", false)).toBe("light")
  })

  it("returns dark when mode is dark, regardless of system preference", () => {
    expect(resolveTheme("dark", true)).toBe("dark")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  it("follows system preference when mode is system", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run app/lib/theme.test.ts`
Expected: FAIL —— 找不到模块 `./theme`。

- [ ] **Step 3: 实现 `app/lib/theme.ts`**

```ts
export type ThemeMode = "light" | "dark" | "system"

export const THEME_STORAGE_KEY = "theme"

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light"
  return mode
}

// 在 <head> 内同步执行，必须在 React 接管前把 data-theme 写到 <html> 上，避免首屏闪烁。
// 逻辑需与 resolveTheme 保持一致，但不能 import（脚本运行时 React/模块系统还未加载）。
export const THEME_INLINE_SCRIPT = `(function(){try{var stored=localStorage.getItem("${THEME_STORAGE_KEY}");var dark=stored==="dark"||(stored!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",dark?"dark":"light")}catch(e){}})()`
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run app/lib/theme.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add app/lib/theme.ts app/lib/theme.test.ts
git commit -m "feat: 新增主题三态解析逻辑 resolveTheme"
```

---

### Task 3: 防闪烁接线 — `app/layout.tsx` + `app/globals.css`

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `THEME_INLINE_SCRIPT`（来自 Task 2 的 `app/lib/theme.ts`）。
- Produces: `<html data-theme>` 属性机制 + `[data-theme='dark']` CSS 选择器，供 Task 4 的 `useThemeMode` 在客户端继续更新同一个属性。

- [ ] **Step 1: 修改 `app/layout.tsx`**

把整个文件改为：

```tsx
import type { Metadata, Viewport } from "next"
import { AntdRegistry } from "@ant-design/nextjs-registry"
import AppShell from "./components/AppShell"
import { THEME_INLINE_SCRIPT } from "./lib/theme"
import "./globals.css"

export const metadata: Metadata = {
  title: "GitHub Star 管理",
  description: "管理 GitHub 仓库与 Star 的个人工具",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
}

const RootLayout = ({ children }: React.PropsWithChildren) => (
  <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: THEME_INLINE_SCRIPT }} />
    </head>
    <body>
      <AntdRegistry>
        <AppShell>{children}</AppShell>
      </AntdRegistry>
    </body>
  </html>
)

export default RootLayout
```

- [ ] **Step 2: 修改 `app/globals.css`**

把：

```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0d1117;
    --foreground: #e6edf3;
  }
}
```

改为：

```css
html[data-theme="dark"] {
  --background: #0d1117;
  --foreground: #e6edf3;
}
```

- [ ] **Step 3: 手动验证（无自动化测试覆盖标记/CSS，先做最小验证，完整验证见 Task 8）**

Run: `npm run dev`

打开 `http://localhost:6602/repos`，浏览器 devtools → Application → Local Storage，手动设置 `theme = dark`，刷新页面：背景应立即是暗色（无闪烁、无白屏闪一下）。删除该 key 后再刷新应恢复跟随系统。

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: 主题闪烁防护接入 data-theme + inline script"
```

---

### Task 4: `AppShell.tsx` — 主题切换按钮

**Files:**
- Modify: `app/components/AppShell.tsx`

**Interfaces:**
- Consumes: `ThemeMode`、`THEME_STORAGE_KEY`、`resolveTheme`（来自 Task 2）；依赖 Task 3 建立的 `data-theme` 属性机制。
- Produces: 头部新增主题 `Dropdown` 按钮；`isDark` 继续驱动 `ConfigProvider` 的 `algorithm`（替换原 `useIsDarkMode`）。

- [ ] **Step 1: 替换 `useIsDarkMode`，新增 `useThemeMode`**

把 `app/components/AppShell.tsx` 顶部的 import 改为：

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ConfigProvider, Dropdown, Layout, Menu, theme, type MenuProps } from "antd"
import { StarFilled, SunOutlined, MoonOutlined, DesktopOutlined } from "@ant-design/icons"
import { THEME_STORAGE_KEY, resolveTheme, type ThemeMode } from "../lib/theme"
```

把 `useIsDarkMode` 函数整段替换为：

```tsx
const THEME_MODE_ICONS: Record<ThemeMode, React.ReactNode> = {
  light: <SunOutlined />,
  dark: <MoonOutlined />,
  system: <DesktopOutlined />,
}

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: "亮色",
  dark: "暗色",
  system: "跟随系统",
}

function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>("system")
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    // 首次挂载时同步已持久化的选择与系统偏好，必然 setState，
    // react-hooks/set-state-in-effect 对此场景误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(stored === "light" || stored === "dark" ? stored : "system")

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefersDark(media.matches)
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const isDark = resolveTheme(mode, prefersDark) === "dark"

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light")
  }, [isDark])

  const setMode = (next: ThemeMode) => {
    setModeState(next)
    if (next === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    }
  }

  return { mode, isDark, setMode }
}
```

- [ ] **Step 2: 在组件内使用新 hook，并渲染主题按钮**

把 `export default function AppShell` 函数体的开头：

```tsx
export default function AppShell({ children }: React.PropsWithChildren) {
  const isDark = useIsDarkMode()
```

改为：

```tsx
export default function AppShell({ children }: React.PropsWithChildren) {
  const { mode, isDark, setMode } = useThemeMode()

  const themeMenuItems: MenuProps["items"] = (["light", "dark", "system"] as ThemeMode[]).map((m) => ({
    key: m,
    label: THEME_MODE_LABELS[m],
    icon: THEME_MODE_ICONS[m],
  }))
```

在 `<Menu ... />` 之后（仍在 `<Layout.Header>` 内）新增主题按钮：

```tsx
          <Menu
            theme="dark"
            mode="horizontal"
            items={NAV_ITEMS}
            selectable={false}
            style={{ flex: 1, minWidth: 0, background: "transparent" }}
          />
          <Dropdown
            menu={{ items: themeMenuItems, selectedKeys: [mode], onClick: ({ key }) => setMode(key as ThemeMode) }}
            trigger={["click"]}
          >
            <a
              onClick={(e) => e.preventDefault()}
              style={{ color: "#fff", fontSize: 18, flexShrink: 0, cursor: "pointer" }}
            >
              {THEME_MODE_ICONS[mode]}
            </a>
          </Dropdown>
```

- [ ] **Step 3: 手动验证**

Run: `npm run dev`

打开 `http://localhost:6602/repos`，点击主题按钮，依次切换"亮色/暗色/跟随系统"：

- 每次点击后 antd 组件（按钮、输入框等）配色应立即切换。
- 刷新页面后选择应保持（亮色/暗色持久化；跟随系统则恢复系统当前偏好）。
- DevTools 中 `<html>` 的 `data-theme` 属性应与所选一致。

- [ ] **Step 4: Commit**

```bash
git add app/components/AppShell.tsx
git commit -m "feat: 顶部菜单新增三态主题切换按钮"
```

---

### Task 5: `SyncContext` — 同步状态全局化

**Files:**
- Create: `app/components/SyncContext.tsx`

**Interfaces:**
- Consumes: `GET /api/sync`（Task 1）、既有的 `POST /api/sync`。
- Produces: `SyncProvider`（组件）、`useSync(): { lastSyncedAt: string | null; syncing: boolean; syncVersion: number; triggerSync: () => Promise<void> }`。Task 6（`AppShell.tsx`）与 Task 7（`RepoList.tsx`）都消费 `useSync()`。

- [ ] **Step 1: 实现 `SyncContext.tsx`**

创建 `app/components/SyncContext.tsx`：

```tsx
"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { message } from "antd"

interface SyncState {
  lastSyncedAt: string | null
  syncing: boolean
  syncVersion: number
  triggerSync: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: React.PropsWithChildren) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncVersion, setSyncVersion] = useState(0)

  useEffect(() => {
    fetch("/api/sync")
      .then((res) => res.json())
      .then((json) => setLastSyncedAt(json.lastSyncedAt ?? null))
  }, [])

  const triggerSync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/sync", { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        message.error(json.error ?? "同步失败")
        return
      }
      message.success(`同步完成：owned ${json.ownedCount} / starred ${json.starredCount}`)
      setLastSyncedAt(new Date().toISOString())
      setSyncVersion((v) => v + 1)
    } finally {
      setSyncing(false)
    }
  }, [])

  return (
    <SyncContext.Provider value={{ lastSyncedAt, syncing, syncVersion, triggerSync }}>
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSync 必须在 SyncProvider 内使用")
  return ctx
}
```

- [ ] **Step 2: 类型检查（暂未接线，先确认无 TS 报错）**

Run: `npx tsc --noEmit`
Expected: 无新增报错（此时 `SyncProvider` 尚未被引用，是预期的"未使用 export"，TS 不会因此报错）。

- [ ] **Step 3: Commit**

```bash
git add app/components/SyncContext.tsx
git commit -m "feat: 新增 SyncContext 管理全局同步状态"
```

---

### Task 6: `AppShell.tsx` — 接入同步按钮与上次同步时间

**Files:**
- Modify: `app/components/AppShell.tsx`

**Interfaces:**
- Consumes: `SyncProvider`、`useSync`（Task 5）。
- Produces: 头部内同步图标按钮 + 上次同步时间文本；整个 `<Layout>` 包裹在 `SyncProvider` 内，供 Task 7 的 `RepoList`（作为 `children` 的后代）消费。

- [ ] **Step 1: import 新增依赖**

在 `app/components/AppShell.tsx` 顶部 import 中追加：

```tsx
import { Tooltip } from "antd"
import { SyncOutlined } from "@ant-design/icons"
import { SyncProvider, useSync } from "./SyncContext"
```

（`Dropdown`、`Layout`、`Menu`、`theme` 等已在 Task 4 中 import，无需重复添加。）

- [ ] **Step 2: 新增格式化时间的小函数 + 头部子组件**

在 `useThemeMode` 函数之后、`export default function AppShell` 之前新增：

```tsx
function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SyncButton() {
  const { lastSyncedAt, syncing, triggerSync } = useSync()
  const label = lastSyncedAt ? `上次同步：${formatSyncTime(lastSyncedAt)}` : "从未同步"

  return (
    <Tooltip title={label}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, color: "#fff" }}>
        <span className="hidden sm:inline" style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
          {label}
        </span>
        <a onClick={(e) => { e.preventDefault(); triggerSync() }} style={{ color: "#fff", fontSize: 18, cursor: "pointer" }}>
          <SyncOutlined spin={syncing} />
        </a>
      </span>
    </Tooltip>
  )
}
```

- [ ] **Step 3: 用 `SyncProvider` 包裹 `Layout`，并渲染 `SyncButton`**

把 `return` 语句中的 `<Layout>` 整体包一层 `<SyncProvider>`：

```tsx
  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#0969da",
          colorSuccess: "#1a7f37",
          borderRadius: 8,
          fontFamily: "var(--font-sans)",
          colorBgLayout: isDark ? "#0d1117" : "#f6f8fa",
        },
        components: {
          Layout: { headerBg: "#161b22" },
          Card: { borderRadiusLG: 12 },
          Select: { controlHeight: 36 },
          Input: { controlHeight: 36 },
          Button: { controlHeightSM: 32 },
        },
      }}
    >
      <SyncProvider>
        <Layout style={{ minHeight: "100vh" }}>
          <Layout.Header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              gap: 16,
              paddingInline: 16,
            }}
          >
            <Link
              href="/repos"
              style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 600, flexShrink: 0 }}
            >
              <StarFilled style={{ fontSize: 18, color: "#fadb14" }} />
              <span style={{ whiteSpace: "nowrap" }}>GitHub Star 管理</span>
            </Link>
            <Menu
              theme="dark"
              mode="horizontal"
              items={NAV_ITEMS}
              selectable={false}
              style={{ flex: 1, minWidth: 0, background: "transparent" }}
            />
            <SyncButton />
            <Dropdown
              menu={{ items: themeMenuItems, selectedKeys: [mode], onClick: ({ key }) => setMode(key as ThemeMode) }}
              trigger={["click"]}
            >
              <a
                onClick={(e) => e.preventDefault()}
                style={{ color: "#fff", fontSize: 18, flexShrink: 0, cursor: "pointer" }}
              >
                {THEME_MODE_ICONS[mode]}
              </a>
            </Dropdown>
          </Layout.Header>
          <Layout.Content style={{ padding: "16px 16px 32px" }}>
            <div className="page-container">{children}</div>
          </Layout.Content>
        </Layout>
      </SyncProvider>
    </ConfigProvider>
  )
}
```

（即：在 `<Menu />` 和 `<Dropdown>` 主题按钮之间插入 `<SyncButton />`；整个 `<Layout>` 套进新增的 `<SyncProvider>`。）

- [ ] **Step 4: 手动验证**

Run: `npm run dev`

打开 `http://localhost:6602/repos`：

- 头部应出现同步图标 + "上次同步：MM-DD HH:mm"（或"从未同步"）文本（宽屏可见文本，缩小窗口到手机宽度时文本隐藏，悬停图标仍能看到 Tooltip）。
- 点击同步图标：图标旋转，完成后 toast 提示，文本更新为当前时间。
- 切到 `http://localhost:6602/stars`，确认头部同步状态（文本/图标）是同一份全局状态，不会因为切页面重置。

- [ ] **Step 5: Commit**

```bash
git add app/components/AppShell.tsx
git commit -m "feat: 顶部菜单接入同步按钮与上次同步时间"
```

---

### Task 7: `RepoList.tsx` — 移除本地同步逻辑，接入 `syncVersion`

**Files:**
- Modify: `app/components/RepoList.tsx`

**Interfaces:**
- Consumes: `useSync()`（Task 5），只用其 `syncVersion` 字段。

- [ ] **Step 1: 精简 import，移除本地同步状态**

把文件顶部 import 由：

```tsx
import { Button, Col, Pagination, Row, Spin, message } from "antd"
import { SyncOutlined } from "@ant-design/icons"
import FilterBar, { type FilterValues } from "./FilterBar"
import RepoCard, { type RepoCardData } from "./RepoCard"
import type { TagOption } from "./TagSelect"
```

改为：

```tsx
import { Col, Pagination, Row, Spin, message } from "antd"
import FilterBar, { type FilterValues } from "./FilterBar"
import RepoCard, { type RepoCardData } from "./RepoCard"
import type { TagOption } from "./TagSelect"
import { useSync } from "./SyncContext"
```

删除：

```tsx
  const [syncing, setSyncing] = useState(false)
```

- [ ] **Step 2: `fetchRepos` 依赖 `syncVersion`，删除 `handleSync`**

在组件函数体内、`fetchRepos` 定义之前新增：

```tsx
  const { syncVersion } = useSync()
```

把 `fetchRepos` 的依赖数组：

```tsx
  }, [source, page, perPage, filters])
```

改为：

```tsx
  }, [source, page, perPage, filters, syncVersion])
```

删除整个 `handleSync` 函数：

```tsx
  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/sync", { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        message.error(json.error ?? "同步失败")
        return
      }
      message.success(`同步完成：owned ${json.ownedCount} / starred ${json.starredCount}`)
      fetchRepos()
    } finally {
      setSyncing(false)
    }
  }
```

- [ ] **Step 3: 简化渲染部分，移除同步按钮**

把：

```tsx
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }} gutter={[16, 16]}>
        <Col flex="auto">
          <FilterBar
            value={filters}
            languages={data?.languages ?? []}
            tags={allTags}
            showStarredSort={source === "starred"}
            onChange={updateFilters}
          />
        </Col>
        <Col xs={24} sm="auto">
          <Button
            icon={<SyncOutlined spin={syncing} />}
            onClick={handleSync}
            loading={syncing}
            className="w-full sm:w-auto"
          >
            同步
          </Button>
        </Col>
      </Row>
```

改为：

```tsx
      <div style={{ marginBottom: 16 }}>
        <FilterBar
          value={filters}
          languages={data?.languages ?? []}
          tags={allTags}
          showStarredSort={source === "starred"}
          onChange={updateFilters}
        />
      </div>
```

（下方仓库卡片栅格仍使用 `Row`/`Col`，因此顶部 import 里这两个标识符继续保留，只移除了 `Button`。）

- [ ] **Step 4: 类型检查 + 跑测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 无报错，全部测试 PASS（`RepoList.tsx` 本身没有自动化测试，这一步主要确认没有破坏其他文件的类型/测试）。

- [ ] **Step 5: 手动验证**

Run: `npm run dev`

打开 `http://localhost:6602/repos`：列表区域上方不再有"同步"按钮；筛选栏占满整行。在顶部菜单点击同步图标，完成后当前列表应自动刷新（可通过同步前后仓库的 `updated_at`/数量变化确认，或临时在 GitHub 上 star/unstar 一个仓库后同步验证）。

- [ ] **Step 6: Commit**

```bash
git add app/components/RepoList.tsx
git commit -m "refactor: RepoList 移除本地同步逻辑，改用全局 SyncContext"
```

---

### Task 8: 端到端手动验证

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 启动 dev server**

Run: `npm run dev`（端口 6602）

- [ ] **Step 2: 主题三态完整走一遍**

打开 `http://localhost:6602/repos`：

1. 点击主题按钮选"暗色" → 页面背景、antd 组件立即变暗；刷新页面 → 仍是暗色，无闪烁。
2. 选"亮色" → 立即变亮；刷新 → 仍是亮色。
3. 选"跟随系统" → 跟随 macOS 当前外观设置；在系统设置里切换系统的亮/暗模式 → 页面应跟着实时变化（不需要手动刷新，因为 `matchMedia` 的 `change` 监听仍然生效）。

- [ ] **Step 3: 同步 + 上次同步时间走一遍**

1. 头部应显示"上次同步：MM-DD HH:mm"（如果本机数据库此前从未同步过，先点一次同步按钮产生数据）。
2. 点击同步图标 → 旋转动画 → 完成后 toast 提示 `同步完成：owned N / starred M` → 时间文本更新为当前时间。
3. 切换到 `http://localhost:6602/stars` → 头部时间与 `/repos` 页一致（全局状态，不因路由切换重置）。
4. 在 `/stars` 页面点击同步 → 列表应自动刷新（不需要手动刷新浏览器）。

- [ ] **Step 4: 移动端宽度检查**

浏览器开发者工具切换到手机视口（如 iPhone 12，390px 宽）：

- 头部 logo + 导航 + 同步图标 + 主题图标不应互相挤压换行或溢出（"上次同步"文字应已隐藏，只剩图标）。
- `/repos`、`/stars` 页面筛选栏与卡片栅格仍正常单列显示（这部分来自此前的移动端适配工作，本次改动不应破坏它）。

- [ ] **Step 5: 全量测试 + 类型检查收尾**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: 全部通过，无报错。

- [ ] **Step 6: 确认无遗留 commit**

Run: `git status`
Expected: working tree clean（前面每个 Task 已分别 commit）。
