# GitHub Starred Repo 管理工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Next.js 16 + antd 项目上，实现一个个人使用的 GitHub 仓库/Star 管理工具：分别加载 owned/starred 仓库列表，支持分页、GitHub 风格筛选、打标签、收藏、备注、star/unstar。

**Architecture:** Next.js 全栈单体应用。`app/api/*` Route Handlers 用 `@octokit/rest` 代理 GitHub API（服务端持有 PAT）、用 Drizzle + better-sqlite3 读写本地 SQLite 缓存；前端是 antd 客户端组件，通过 fetch 调用这些 API。GitHub 数据缓存表（`repos`）与用户数据表（`repo_user_data`/`tags`/`repo_tags`）严格分离，所有筛选/排序/分页在本地 SQL 完成。

**Tech Stack:** Next.js 16 (App Router) / React 19 / antd 6 / better-sqlite3 / drizzle-orm / @octokit/rest / Vitest

## Global Constraints

- 仅个人使用（用户 lxthyme），认证用 GitHub Personal Access Token，存于 `.env.local` 的 `GITHUB_TOKEN`，只在服务端（Route Handler）读取，绝不下发到客户端。
- 移动端 = 响应式 Web，不做独立 App；列表 UI 用 antd 响应式 Card/Row/Col 栅格，不用 Table。
- 本地运行 + SQLite：`better-sqlite3` + `drizzle-orm`，数据库文件 `data/app.db`，不使用 drizzle-kit 迁移文件，改用 `CREATE TABLE IF NOT EXISTS` 在连接建立时幂等执行表结构。
- Next.js 16：`page.tsx` 的 `params`/`searchParams` 以及 Route Handler 的 `{ params }` 均为 `Promise`，必须 `await` 后才能使用；使用 `useSearchParams()` 的客户端组件必须包在 `<Suspense>` 里。
- GitHub star 状态（`repos.is_starred`，来自同步）与应用内"收藏"（`repo_user_data.is_favorite`）是两个独立标记，互不影响。
- 同步只能由页面上的"同步"按钮手动触发（`POST /api/sync`），不做定时任务。同步是"重置所有 is_owned/is_starred 为 0，再用本次拉取结果重新置 1"的整表操作，绝不删除/清空 `repo_user_data`。
- 默认分页大小 30 条/页，服务端分页（SQL `LIMIT/OFFSET`），不做无限滚动。
- 测试范围：仅 `lib/db/*` 数据层（CRUD、筛选 SQL 拼装、sync 的 upsert 逻辑）写 Vitest 单测；API 路由和前端组件用手动验证（curl / 浏览器），不做自动化 E2E — 与已批准设计文档的"测试策略"一致。

---

## 文件结构总览

```
app/
  page.tsx                             -- 改为重定向到 /repos（替换 create-next-app 默认首页）
  layout.tsx                           -- 改为带顶部导航的 antd Layout
  repos/page.tsx                       -- 我的仓库 tab（Server Component 外壳）
  stars/page.tsx                       -- 已 Star 仓库 tab（Server Component 外壳）
  components/
    RepoList.tsx                       -- 共享列表：筛选栏 + 分页 + Card 网格 + 同步按钮 + 数据获取
    RepoCard.tsx                       -- 单个 repo 卡片
    FilterBar.tsx                      -- 筛选栏
    TagSelect.tsx                      -- 标签选择/新建
    NoteEditor.tsx                     -- 备注查看/编辑
  api/
    sync/route.ts                      -- POST 全量同步
    repos/route.ts                     -- GET 列表（筛选/排序/分页）
    repos/[id]/favorite/route.ts       -- PATCH 收藏切换
    repos/[id]/note/route.ts           -- PATCH 备注
    repos/[id]/tags/route.ts           -- GET/PUT 标签关联
    repos/[id]/star/route.ts           -- PUT/DELETE 触发 GitHub star/unstar
    tags/route.ts                      -- GET 全部 tag / POST 新建
lib/
  github.ts                            -- octokit 封装：listOwnedRepos / listStarredRepos / starRepo / unstarRepo
  db/
    schema.ts                          -- Drizzle schema：repos / repo_user_data / tags / repo_tags
    client.ts                          -- better-sqlite3 连接 + 表结构 bootstrap（createDb 工厂 + 单例 db）
    repos.ts                           -- repos 查询层：listRepos / listDistinctLanguages / setStarred
    tags.ts                            -- tags 数据层：listTags / createTag / getRepoTags / setRepoTags
    user-data.ts                       -- repo_user_data 数据层：setFavorite / setNote / getUserData
    sync.ts                            -- 同步逻辑：syncRepos（合并 owned+starred，重置后整表 upsert）
data/app.db                            -- SQLite 文件（运行时创建，.gitignore 已排除）
.env.local.example                     -- GITHUB_TOKEN 模板
vitest.config.ts                       -- Vitest 配置
```

与设计文档相比的小调整：新增了 `lib/db/sync.ts`（设计文档把同步逻辑归在 `queries.ts` 概览里，这里拆成独立文件，单一职责）；`queries.ts` 拆分为 `repos.ts`/`tags.ts`/`user-data.ts` 三个文件，避免一个文件承担三张表的查询逻辑。

---

### Task 1: 依赖安装与测试/环境基础设施

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run test` / `npm run test:watch` 脚本，后续所有数据层任务依赖它们；`GITHUB_TOKEN` 环境变量约定，后续 `lib/github.ts` 和 API 路由依赖它。

- [x] **Step 1: 安装运行时依赖**

```bash
npm install antd @ant-design/icons better-sqlite3 drizzle-orm @octokit/rest
```

- [x] **Step 2: 安装开发依赖**

```bash
npm install -D vitest @types/better-sqlite3
```

- [x] **Step 3: 创建 Vitest 配置**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
})
```

- [x] **Step 4: 添加测试脚本**

修改 `package.json` 的 `scripts` 字段，加入：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [x] **Step 5: 创建环境变量模板**

`.env.local.example`:

```
GITHUB_TOKEN=ghp_your_personal_access_token
```

- [x] **Step 6: 更新 .gitignore**

在 `.gitignore` 的 `# env files` 段落后追加（取消忽略示例文件，忽略 SQLite 数据文件）：

```gitignore
!.env.local.example

# sqlite
/data/*.db
/data/*.db-*
```

- [x] **Step 7: 验证**

```bash
npx tsc --noEmit
```

Expected: 无报错（此时还没有新代码引用新依赖，只是确认依赖安装没有破坏现有类型检查）。

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .env.local.example .gitignore
git commit -m "添加数据库/GitHub API/测试相关依赖与基础配置"
```

---

### Task 2: 数据库 Schema 与连接

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Test: `lib/db/client.test.ts`

**Interfaces:**
- Produces: `schema.ts` 导出 `repos` / `repoUserData` / `tags` / `repoTags` 四个 Drizzle 表对象；`client.ts` 导出 `createDb(dbPath: string): AppDatabase` 工厂函数、`AppDatabase` 类型、以及单例 `db`。后续所有 `lib/db/*.ts` 和 API 路由都依赖 `db` 或 `AppDatabase` 类型；测试依赖 `createDb(':memory:')`。

- [ ] **Step 1: 写 schema**

`lib/db/schema.ts`:

```ts
import { sqliteTable, integer, text, primaryKey } from "drizzle-orm/sqlite-core"

export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey(),
  fullName: text("full_name").notNull(),
  name: text("name").notNull(),
  ownerLogin: text("owner_login").notNull(),
  ownerAvatar: text("owner_avatar"),
  description: text("description"),
  htmlUrl: text("html_url").notNull(),
  language: text("language"),
  topics: text("topics").notNull().default("[]"),
  stargazersCount: integer("stargazers_count").notNull().default(0),
  forksCount: integer("forks_count").notNull().default(0),
  archived: integer("archived").notNull().default(0),
  fork: integer("fork").notNull().default(0),
  private: integer("private").notNull().default(0),
  isTemplate: integer("is_template").notNull().default(0),
  pushedAt: text("pushed_at"),
  updatedAt: text("updated_at"),
  createdAt: text("created_at"),
  isOwned: integer("is_owned").notNull().default(0),
  isStarred: integer("is_starred").notNull().default(0),
  starredAt: text("starred_at"),
  syncedAt: text("synced_at"),
})

export const repoUserData = sqliteTable("repo_user_data", {
  repoId: integer("repo_id").primaryKey(),
  isFavorite: integer("is_favorite").notNull().default(0),
  note: text("note"),
  noteUpdatedAt: text("note_updated_at"),
})

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
})

export const repoTags = sqliteTable(
  "repo_tags",
  {
    repoId: integer("repo_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.repoId, table.tagId] })]
)
```

- [ ] **Step 2: 写 client（含表结构 bootstrap）**

`lib/db/client.ts`:

```ts
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import * as schema from "./schema"

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  owner_avatar TEXT,
  description TEXT,
  html_url TEXT NOT NULL,
  language TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  stargazers_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  fork INTEGER NOT NULL DEFAULT 0,
  private INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  pushed_at TEXT,
  updated_at TEXT,
  created_at TEXT,
  is_owned INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  starred_at TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS repo_user_data (
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id),
  is_favorite INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  note_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_tags (
  repo_id INTEGER NOT NULL REFERENCES repos(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (repo_id, tag_id)
);
`

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

export function createDb(dbPath: string): AppDatabase {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.exec(SCHEMA_SQL)
  return drizzle(sqlite, { schema })
}

declare global {
  // eslint-disable-next-line no-var
  var __appDb: AppDatabase | undefined
}

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db")

export const db = globalThis.__appDb ?? createDb(dbPath)

if (process.env.NODE_ENV !== "production") {
  globalThis.__appDb = db
}
```

- [ ] **Step 3: 写测试**

`lib/db/client.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createDb } from "./client"
import { repos, repoUserData, tags, repoTags } from "./schema"

describe("createDb", () => {
  it("creates all four tables and allows inserting into each", () => {
    const db = createDb(":memory:")

    db.insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
      })
      .run()
    db.insert(repoUserData).values({ repoId: 1, isFavorite: 1 }).run()
    db.insert(tags).values({ name: "favorite-tools", createdAt: "2026-01-01T00:00:00Z" }).run()
    const tag = db.select().from(tags).get()!
    db.insert(repoTags).values({ repoId: 1, tagId: tag.id }).run()

    expect(db.select().from(repos).all()).toHaveLength(1)
    expect(db.select().from(repoUserData).all()).toHaveLength(1)
    expect(db.select().from(repoTags).all()).toHaveLength(1)
  })

  it("returns independent state for separate :memory: instances", () => {
    const dbA = createDb(":memory:")
    const dbB = createDb(":memory:")

    db_insert_one(dbA)

    expect(dbA.select().from(repos).all()).toHaveLength(1)
    expect(dbB.select().from(repos).all()).toHaveLength(0)
  })
})

function db_insert_one(db: ReturnType<typeof createDb>) {
  db.insert(repos)
    .values({
      id: 1,
      fullName: "octocat/Hello-World",
      name: "Hello-World",
      ownerLogin: "octocat",
      htmlUrl: "https://github.com/octocat/Hello-World",
    })
    .run()
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- lib/db/client.test.ts
```

Expected: 2 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/client.ts lib/db/client.test.ts
git commit -m "添加 SQLite 数据库 schema 与连接（repos/repo_user_data/tags/repo_tags）"
```

---

### Task 3: repos 查询层（筛选 / 排序 / 分页 / setStarred）

**Files:**
- Create: `lib/db/repos.ts`
- Test: `lib/db/repos.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` / `createDb` from `./client`（Task 2）；`repos`, `repoUserData`, `repoTags`, `tags` from `./schema`（Task 2）。
- Produces: `listRepos(db, params: ListReposParams): ListReposResult`、`listDistinctLanguages(db, source): string[]`、`setStarred(db, repoId, isStarred): void`，以及类型 `ListReposParams` / `RepoListItem` / `ListReposResult` / `RepoSource` / `RepoTypeFilter` / `RepoSort` / `TriStateFilter` / `NoteFilterValue`。Task 9（GET /api/repos）、Task 12（star 路由）、Task 17（RepoList 前端类型）都依赖这些精确名称。

- [ ] **Step 1: 写测试**

`lib/db/repos.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest"
import { sql } from "drizzle-orm"
import { createDb, type AppDatabase } from "./client"
import { repoUserData, repoTags, tags } from "./schema"
import { listRepos, listDistinctLanguages, setStarred } from "./repos"

describe("listRepos", () => {
  let db: AppDatabase

  beforeEach(() => {
    db = createDb(":memory:")
  })

  function insertRepo(overrides: Partial<{
    id: number
    name: string
    fullName: string
    language: string | null
    fork: number
    archived: number
    isTemplate: number
    isOwned: number
    isStarred: number
    starredAt: string | null
    stargazersCount: number
    pushedAt: string | null
  }> = {}) {
    const repo = {
      id: 1,
      name: "Hello-World",
      fullName: "octocat/Hello-World",
      language: "TypeScript" as string | null,
      fork: 0,
      archived: 0,
      isTemplate: 0,
      isOwned: 1,
      isStarred: 0,
      starredAt: null as string | null,
      stargazersCount: 0,
      pushedAt: "2026-01-01T00:00:00Z" as string | null,
      ...overrides,
    }
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, language, fork, archived, is_template, is_owned, is_starred, starred_at, stargazers_count, pushed_at)
         VALUES (${repo.id}, '${repo.fullName}', '${repo.name}', 'octocat', 'https://github.com/${repo.fullName}', ${repo.language ? `'${repo.language}'` : "NULL"}, ${repo.fork}, ${repo.archived}, ${repo.isTemplate}, ${repo.isOwned}, ${repo.isStarred}, ${repo.starredAt ? `'${repo.starredAt}'` : "NULL"}, ${repo.stargazersCount}, '${repo.pushedAt}')`
      )
    )
  }

  it("filters by source (owned vs starred)", () => {
    insertRepo({ id: 1, isOwned: 1, isStarred: 0 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife", isOwned: 0, isStarred: 1 })

    expect(listRepos(db, { source: "owned" }).items.map((r) => r.id)).toEqual([1])
    expect(listRepos(db, { source: "starred" }).items.map((r) => r.id)).toEqual([2])
  })

  it("filters by type=forks", () => {
    insertRepo({ id: 1, fork: 0 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife", fork: 1 })

    const result = listRepos(db, { source: "owned", type: "forks" })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("excludes forks/archived/templates from type=sources", () => {
    insertRepo({ id: 1, fork: 0, archived: 0, isTemplate: 0 })
    insertRepo({ id: 2, fullName: "octocat/Fork", name: "Fork", fork: 1 })
    insertRepo({ id: 3, fullName: "octocat/Old", name: "Old", archived: 1 })

    const result = listRepos(db, { source: "owned", type: "sources" })
    expect(result.items.map((r) => r.id)).toEqual([1])
  })

  it("ignores language filter when set to 'all'", () => {
    insertRepo({ id: 1, language: "TypeScript" })
    insertRepo({ id: 2, fullName: "octocat/Py", name: "Py", language: "Python" })

    const result = listRepos(db, { source: "owned", language: "all" })
    expect(result.items).toHaveLength(2)
  })

  it("filters by a specific language", () => {
    insertRepo({ id: 1, language: "TypeScript" })
    insertRepo({ id: 2, fullName: "octocat/Py", name: "Py", language: "Python" })

    const result = listRepos(db, { source: "owned", language: "Python" })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by favorite status using repo_user_data", () => {
    insertRepo({ id: 1 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })
    db.insert(repoUserData).values({ repoId: 1, isFavorite: 1 }).run()

    expect(listRepos(db, { source: "owned", favorite: "favorite" }).items.map((r) => r.id)).toEqual([1])
    expect(listRepos(db, { source: "owned", favorite: "not_favorite" }).items.map((r) => r.id)).toEqual([2])
  })

  it("filters by note status using repo_user_data", () => {
    insertRepo({ id: 1 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })
    db.insert(repoUserData).values({ repoId: 1, note: "记得看看" }).run()

    expect(listRepos(db, { source: "owned", note: "noted" }).items.map((r) => r.id)).toEqual([1])
    expect(listRepos(db, { source: "owned", note: "not_noted" }).items.map((r) => r.id)).toEqual([2])
  })

  it("filters by tagId and by 'untagged'", () => {
    insertRepo({ id: 1 })
    insertRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })
    db.insert(tags).values({ id: 1, name: "cli", createdAt: "2026-01-01T00:00:00Z" }).run()
    db.insert(repoTags).values({ repoId: 1, tagId: 1 }).run()

    expect(listRepos(db, { source: "owned", tagId: 1 }).items.map((r) => r.id)).toEqual([1])
    expect(listRepos(db, { source: "owned", tagId: "untagged" }).items.map((r) => r.id)).toEqual([2])
  })

  it("attaches resolved tags to each item", () => {
    insertRepo({ id: 1 })
    db.insert(tags).values({ id: 1, name: "cli", createdAt: "2026-01-01T00:00:00Z" }).run()
    db.insert(repoTags).values({ repoId: 1, tagId: 1 }).run()

    const result = listRepos(db, { source: "owned" })
    expect(result.items[0].tags).toEqual([{ id: 1, name: "cli" }])
  })

  it("sorts by name ascending and by stars descending", () => {
    insertRepo({ id: 1, name: "Zeta", fullName: "octocat/Zeta", stargazersCount: 1 })
    insertRepo({ id: 2, name: "Alpha", fullName: "octocat/Alpha", stargazersCount: 9 })

    expect(listRepos(db, { source: "owned", sort: "name" }).items.map((r) => r.name)).toEqual(["Alpha", "Zeta"])
    expect(listRepos(db, { source: "owned", sort: "stars" }).items.map((r) => r.id)).toEqual([2, 1])
  })

  it("paginates with the given page size", () => {
    for (let i = 1; i <= 5; i++) {
      insertRepo({ id: i, name: `Repo${i}`, fullName: `octocat/Repo${i}` })
    }

    const page1 = listRepos(db, { source: "owned", perPage: 2, page: 1 })
    const page2 = listRepos(db, { source: "owned", perPage: 2, page: 2 })

    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(2)
    expect(page1.total).toBe(5)
  })
})

describe("listDistinctLanguages", () => {
  it("returns sorted unique languages for the given source", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, language, is_owned) VALUES
         (1, 'octocat/A', 'A', 'octocat', 'https://x', 'TypeScript', 1),
         (2, 'octocat/B', 'B', 'octocat', 'https://x', 'Python', 1),
         (3, 'octocat/C', 'C', 'octocat', 'https://x', 'TypeScript', 1),
         (4, 'octocat/D', 'D', 'octocat', 'https://x', 'Go', 0)`
      )
    )

    expect(listDistinctLanguages(db, "owned")).toEqual(["Python", "TypeScript"])
  })
})

describe("setStarred", () => {
  it("updates is_starred and starred_at", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`
      )
    )

    setStarred(db, 1, true)
    expect(listRepos(db, { source: "owned" }).items[0].isStarred).toBe(true)

    setStarred(db, 1, false)
    expect(listRepos(db, { source: "owned" }).items[0].isStarred).toBe(false)
  })
})
```

`db.run(sql.raw(...))` 是因为 Drizzle 的 `AppDatabase` 没有"执行原始 SQL 字符串"的顶层方法，必须用 `sql.raw()` 包装后通过 `db.run()` 执行——这只在测试里为了快速造数据用，正式查询代码（Step 4）全部走 Drizzle 的类型安全 API，不出现原始字符串拼接。

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- lib/db/repos.test.ts
```

Expected: FAIL，提示 `./repos` 模块不存在或 `listRepos` 未定义。

- [ ] **Step 3: 实现 repos.ts**

`lib/db/repos.ts`:

```ts
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos, repoUserData, repoTags, tags } from "./schema"

export type RepoSource = "owned" | "starred"
export type RepoTypeFilter = "all" | "sources" | "forks" | "archived" | "templates"
export type RepoSort = "updated" | "name" | "stars" | "starred_at"
export type TriStateFilter = "all" | "favorite" | "not_favorite"
export type NoteFilterValue = "all" | "noted" | "not_noted"

export interface ListReposParams {
  source: RepoSource
  search?: string
  type?: RepoTypeFilter
  language?: string
  sort?: RepoSort
  favorite?: TriStateFilter
  note?: NoteFilterValue
  tagId?: number | "untagged"
  page?: number
  perPage?: number
}

export interface RepoListItem {
  id: number
  fullName: string
  name: string
  ownerLogin: string
  ownerAvatar: string | null
  description: string | null
  htmlUrl: string
  language: string | null
  topics: string[]
  stargazersCount: number
  forksCount: number
  archived: boolean
  fork: boolean
  private: boolean
  isTemplate: boolean
  pushedAt: string | null
  updatedAt: string | null
  isOwned: boolean
  isStarred: boolean
  starredAt: string | null
  isFavorite: boolean
  note: string | null
  tags: { id: number; name: string }[]
}

export interface ListReposResult {
  items: RepoListItem[]
  total: number
  page: number
  perPage: number
}

const DEFAULT_PER_PAGE = 30

function buildWhere(params: ListReposParams): SQL | undefined {
  const conditions: SQL[] = []

  conditions.push(params.source === "owned" ? eq(repos.isOwned, 1) : eq(repos.isStarred, 1))

  if (params.search) {
    const term = `%${params.search}%`
    conditions.push(sql`(${repos.name} LIKE ${term} OR ${repos.description} LIKE ${term})`)
  }

  if (params.type === "sources") {
    conditions.push(eq(repos.fork, 0), eq(repos.archived, 0), eq(repos.isTemplate, 0))
  } else if (params.type === "forks") {
    conditions.push(eq(repos.fork, 1))
  } else if (params.type === "archived") {
    conditions.push(eq(repos.archived, 1))
  } else if (params.type === "templates") {
    conditions.push(eq(repos.isTemplate, 1))
  }

  if (params.language && params.language !== "all") {
    conditions.push(eq(repos.language, params.language))
  }

  if (params.favorite === "favorite") {
    conditions.push(eq(repoUserData.isFavorite, 1))
  } else if (params.favorite === "not_favorite") {
    conditions.push(sql`COALESCE(${repoUserData.isFavorite}, 0) = 0`)
  }

  if (params.note === "noted") {
    conditions.push(sql`(${repoUserData.note} IS NOT NULL AND ${repoUserData.note} != '')`)
  } else if (params.note === "not_noted") {
    conditions.push(sql`(${repoUserData.note} IS NULL OR ${repoUserData.note} = '')`)
  }

  if (params.tagId === "untagged") {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id})`)
  } else if (typeof params.tagId === "number") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id} AND ${repoTags.tagId} = ${params.tagId})`
    )
  }

  return and(...conditions)
}

export function listRepos(db: AppDatabase, params: ListReposParams): ListReposResult {
  const page = params.page && params.page > 0 ? params.page : 1
  const perPage = params.perPage && params.perPage > 0 ? params.perPage : DEFAULT_PER_PAGE
  const where = buildWhere(params)

  const sortColumnMap = {
    updated: repos.pushedAt,
    name: repos.name,
    stars: repos.stargazersCount,
    starred_at: repos.starredAt,
  } as const
  const sortColumn = sortColumnMap[params.sort ?? "updated"]
  const orderFn = params.sort === "name" ? asc : desc

  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(repos)
    .leftJoin(repoUserData, eq(repoUserData.repoId, repos.id))
    .where(where)
    .get()!.count

  const rows = db
    .select({ repo: repos, isFavorite: repoUserData.isFavorite, note: repoUserData.note })
    .from(repos)
    .leftJoin(repoUserData, eq(repoUserData.repoId, repos.id))
    .where(where)
    .orderBy(orderFn(sortColumn))
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all()

  const repoIds = rows.map((row) => row.repo.id)
  const tagRows = repoIds.length
    ? db
        .select({ repoId: repoTags.repoId, tagId: tags.id, tagName: tags.name })
        .from(repoTags)
        .innerJoin(tags, eq(tags.id, repoTags.tagId))
        .where(inArray(repoTags.repoId, repoIds))
        .all()
    : []

  const tagsByRepoId = new Map<number, { id: number; name: string }[]>()
  for (const row of tagRows) {
    const list = tagsByRepoId.get(row.repoId) ?? []
    list.push({ id: row.tagId, name: row.tagName })
    tagsByRepoId.set(row.repoId, list)
  }

  const items: RepoListItem[] = rows.map(({ repo, isFavorite, note }) => ({
    id: repo.id,
    fullName: repo.fullName,
    name: repo.name,
    ownerLogin: repo.ownerLogin,
    ownerAvatar: repo.ownerAvatar,
    description: repo.description,
    htmlUrl: repo.htmlUrl,
    language: repo.language,
    topics: JSON.parse(repo.topics) as string[],
    stargazersCount: repo.stargazersCount,
    forksCount: repo.forksCount,
    archived: repo.archived === 1,
    fork: repo.fork === 1,
    private: repo.private === 1,
    isTemplate: repo.isTemplate === 1,
    pushedAt: repo.pushedAt,
    updatedAt: repo.updatedAt,
    isOwned: repo.isOwned === 1,
    isStarred: repo.isStarred === 1,
    starredAt: repo.starredAt,
    isFavorite: isFavorite === 1,
    note,
    tags: tagsByRepoId.get(repo.id) ?? [],
  }))

  return { items, total, page, perPage }
}

export function listDistinctLanguages(db: AppDatabase, source: RepoSource): string[] {
  const sourceCondition = source === "owned" ? eq(repos.isOwned, 1) : eq(repos.isStarred, 1)
  const rows = db
    .select({ language: repos.language })
    .from(repos)
    .where(and(sourceCondition, sql`${repos.language} IS NOT NULL`))
    .all()
  return [...new Set(rows.map((row) => row.language as string))].sort()
}

export function setStarred(db: AppDatabase, repoId: number, isStarred: boolean): void {
  db.update(repos)
    .set({ isStarred: isStarred ? 1 : 0, starredAt: isStarred ? new Date().toISOString() : null })
    .where(eq(repos.id, repoId))
    .run()
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- lib/db/repos.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/db/repos.ts lib/db/repos.test.ts
git commit -m "实现 repos 查询层：筛选/排序/分页与 setStarred"
```

---

### Task 4: tags 数据层

**Files:**
- Create: `lib/db/tags.ts`
- Test: `lib/db/tags.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `./client`（Task 2）；`repoTags`, `tags` from `./schema`（Task 2）。
- Produces: `listTags(db): TagOption[]`、`createTag(db, name): TagOption`（按名称幂等，已存在则返回原有记录）、`getRepoTags(db, repoId): TagOption[]`、`setRepoTags(db, repoId, tagNames: string[]): TagOption[]`（整体替换某个 repo 的标签集合），类型 `TagOption { id: number; name: string }`。Task 11（tags 相关路由）、Task 13（TagSelect 组件）依赖这些名称。

- [ ] **Step 1: 写测试**

`lib/db/tags.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { createDb } from "./client"
import { listTags, createTag, getRepoTags, setRepoTags } from "./tags"

describe("createTag", () => {
  it("creates a new tag", () => {
    const db = createDb(":memory:")
    const tag = createTag(db, "cli-tools")
    expect(tag.name).toBe("cli-tools")
    expect(listTags(db)).toEqual([{ id: tag.id, name: "cli-tools" }])
  })

  it("is idempotent for an existing name", () => {
    const db = createDb(":memory:")
    const first = createTag(db, "cli-tools")
    const second = createTag(db, "cli-tools")
    expect(second.id).toBe(first.id)
    expect(listTags(db)).toHaveLength(1)
  })
})

describe("listTags", () => {
  it("returns tags sorted by name", () => {
    const db = createDb(":memory:")
    createTag(db, "zebra")
    createTag(db, "alpha")
    expect(listTags(db).map((t) => t.name)).toEqual(["alpha", "zebra"])
  })
})

describe("setRepoTags / getRepoTags", () => {
  it("attaches tags to a repo, creating new ones as needed", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`
      )
    )

    const result = setRepoTags(db, 1, ["cli", "favorite-tools"])
    expect(result.map((t) => t.name).sort()).toEqual(["cli", "favorite-tools"])
    expect(getRepoTags(db, 1).map((t) => t.name).sort()).toEqual(["cli", "favorite-tools"])
  })

  it("replaces the previous tag set rather than appending", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`
      )
    )

    setRepoTags(db, 1, ["cli", "old-tag"])
    setRepoTags(db, 1, ["cli", "new-tag"])

    expect(getRepoTags(db, 1).map((t) => t.name).sort()).toEqual(["cli", "new-tag"])
  })

  it("trims whitespace and drops empty/duplicate names", () => {
    const db = createDb(":memory:")
    db.run(
      sql.raw(
        `INSERT INTO repos (id, full_name, name, owner_login, html_url, is_owned) VALUES (1, 'octocat/A', 'A', 'octocat', 'https://x', 1)`
      )
    )

    const result = setRepoTags(db, 1, [" cli ", "cli", "", "  "])
    expect(result.map((t) => t.name)).toEqual(["cli"])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- lib/db/tags.test.ts
```

Expected: FAIL，提示 `./tags` 模块不存在。

- [ ] **Step 3: 实现 tags.ts**

`lib/db/tags.ts`:

```ts
import { eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoTags, tags } from "./schema"

export interface TagOption {
  id: number
  name: string
}

export function listTags(db: AppDatabase): TagOption[] {
  return db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(tags.name).all()
}

export function createTag(db: AppDatabase, name: string): TagOption {
  const existing = db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.name, name)).get()
  if (existing) return existing

  const now = new Date().toISOString()
  const result = db.insert(tags).values({ name, createdAt: now }).run()
  return { id: Number(result.lastInsertRowid), name }
}

export function getRepoTags(db: AppDatabase, repoId: number): TagOption[] {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(repoTags)
    .innerJoin(tags, eq(tags.id, repoTags.tagId))
    .where(eq(repoTags.repoId, repoId))
    .orderBy(tags.name)
    .all()
}

export function setRepoTags(db: AppDatabase, repoId: number, tagNames: string[]): TagOption[] {
  const uniqueNames = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))]
  const resolved = uniqueNames.map((name) => createTag(db, name))

  db.transaction((tx) => {
    tx.delete(repoTags).where(eq(repoTags.repoId, repoId)).run()
    for (const tag of resolved) {
      tx.insert(repoTags).values({ repoId, tagId: tag.id }).run()
    }
  })

  return resolved
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- lib/db/tags.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/db/tags.ts lib/db/tags.test.ts
git commit -m "实现 tags 数据层：创建/查询标签与 repo-标签关联"
```

---

### Task 5: repo_user_data 数据层（收藏 / 备注）

**Files:**
- Create: `lib/db/user-data.ts`
- Test: `lib/db/user-data.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `./client`（Task 2）；`repoUserData` from `./schema`（Task 2）。
- Produces: `setFavorite(db, repoId, isFavorite: boolean): void`、`setNote(db, repoId, note: string): void`、`getUserData(db, repoId): { isFavorite: boolean; note: string | null }`。Task 10（favorite/note 路由）依赖这些名称。

- [ ] **Step 1: 写测试**

`lib/db/user-data.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createDb } from "./client"
import { setFavorite, setNote, getUserData } from "./user-data"

describe("setFavorite", () => {
  it("creates a repo_user_data row on first call", () => {
    const db = createDb(":memory:")
    setFavorite(db, 1, true)
    expect(getUserData(db, 1)).toEqual({ isFavorite: true, note: null })
  })

  it("toggles favorite without affecting an existing note", () => {
    const db = createDb(":memory:")
    setNote(db, 1, "记得看看")
    setFavorite(db, 1, true)
    setFavorite(db, 1, false)
    expect(getUserData(db, 1)).toEqual({ isFavorite: false, note: "记得看看" })
  })
})

describe("setNote", () => {
  it("creates a repo_user_data row on first call", () => {
    const db = createDb(":memory:")
    setNote(db, 1, "值得学习的项目")
    expect(getUserData(db, 1)).toEqual({ isFavorite: false, note: "值得学习的项目" })
  })

  it("overwrites the previous note without affecting favorite status", () => {
    const db = createDb(":memory:")
    setFavorite(db, 1, true)
    setNote(db, 1, "first")
    setNote(db, 1, "second")
    expect(getUserData(db, 1)).toEqual({ isFavorite: true, note: "second" })
  })
})

describe("getUserData", () => {
  it("returns defaults for a repo with no user data yet", () => {
    const db = createDb(":memory:")
    expect(getUserData(db, 999)).toEqual({ isFavorite: false, note: null })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- lib/db/user-data.test.ts
```

Expected: FAIL，提示 `./user-data` 模块不存在。

- [ ] **Step 3: 实现 user-data.ts**

`lib/db/user-data.ts`:

```ts
import { eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoUserData } from "./schema"

export function setFavorite(db: AppDatabase, repoId: number, isFavorite: boolean): void {
  db.insert(repoUserData)
    .values({ repoId, isFavorite: isFavorite ? 1 : 0 })
    .onConflictDoUpdate({
      target: repoUserData.repoId,
      set: { isFavorite: isFavorite ? 1 : 0 },
    })
    .run()
}

export function setNote(db: AppDatabase, repoId: number, note: string): void {
  const now = new Date().toISOString()
  db.insert(repoUserData)
    .values({ repoId, note, noteUpdatedAt: now })
    .onConflictDoUpdate({
      target: repoUserData.repoId,
      set: { note, noteUpdatedAt: now },
    })
    .run()
}

export function getUserData(db: AppDatabase, repoId: number): { isFavorite: boolean; note: string | null } {
  const row = db.select().from(repoUserData).where(eq(repoUserData.repoId, repoId)).get()
  return {
    isFavorite: row?.isFavorite === 1,
    note: row?.note ?? null,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- lib/db/user-data.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/db/user-data.ts lib/db/user-data.test.ts
git commit -m "实现 repo_user_data 数据层：收藏与备注的读写"
```

---

### Task 6: GitHub API 封装

**Files:**
- Create: `lib/github.ts`
- Test: `lib/github.test.ts`

**Interfaces:**
- Produces: `createGitHubClient(token: string): Octokit`、`listOwnedRepos(client): Promise<GitHubRepoData[]>`、`listStarredRepos(client): Promise<StarredRepoData[]>`、`starRepo(client, owner, repo): Promise<void>`、`unstarRepo(client, owner, repo): Promise<void>`，类型 `GitHubRepoData`（字段名与 `lib/db/sync.ts`、`lib/db/repos.ts` 的 `RepoListItem` 保持一致的 camelCase 命名）和 `StarredRepoData { repo: GitHubRepoData; starredAt: string }`。Task 7（sync）、Task 8（/api/sync）、Task 12（/api/repos/[id]/star）依赖这些名称。
- 测试范围说明：本任务只测 `mapRepo` 的字段转换逻辑（用一个满足最小接口的 stub client，不发真实网络请求），不测试 `starRepo`/`unstarRepo` 的网络行为——这部分按设计文档"测试策略"的约定，在 Task 8 用真实 `GITHUB_TOKEN` 跑 `POST /api/sync` 时手动验证一次即可。

- [ ] **Step 1: 写测试**

`lib/github.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { listOwnedRepos, listStarredRepos } from "./github"

const RAW_REPO = {
  id: 1,
  full_name: "octocat/Hello-World",
  name: "Hello-World",
  owner: { login: "octocat", avatar_url: "https://avatars/octocat" },
  description: "My first repo",
  html_url: "https://github.com/octocat/Hello-World",
  language: "TypeScript",
  topics: ["demo"],
  stargazers_count: 10,
  forks_count: 2,
  archived: false,
  fork: false,
  private: false,
  is_template: false,
  pushed_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
}

function makeStubClient(paginateResult: unknown) {
  return {
    paginate: vi.fn().mockResolvedValue(paginateResult),
    rest: {
      repos: { listForAuthenticatedUser: vi.fn() },
      activity: { listReposStarredByAuthenticatedUser: vi.fn() },
    },
  } as unknown as Parameters<typeof listOwnedRepos>[0]
}

describe("listOwnedRepos", () => {
  it("maps raw GitHub repo fields to camelCase GitHubRepoData", async () => {
    const client = makeStubClient([RAW_REPO])
    const result = await listOwnedRepos(client)

    expect(result).toEqual([
      {
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        ownerAvatar: "https://avatars/octocat",
        description: "My first repo",
        htmlUrl: "https://github.com/octocat/Hello-World",
        language: "TypeScript",
        topics: ["demo"],
        stargazersCount: 10,
        forksCount: 2,
        archived: false,
        fork: false,
        private: false,
        isTemplate: false,
        pushedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ])
  })

  it("defaults missing optional fields to null/empty", async () => {
    const client = makeStubClient([{ ...RAW_REPO, description: null, topics: undefined, language: null }])
    const result = await listOwnedRepos(client)
    expect(result[0].description).toBeNull()
    expect(result[0].topics).toEqual([])
    expect(result[0].language).toBeNull()
  })
})

describe("listStarredRepos", () => {
  it("maps the {starred_at, repo} wrapper used by the star+json media type", async () => {
    const client = makeStubClient([{ starred_at: "2026-03-01T00:00:00Z", repo: RAW_REPO }])
    const result = await listStarredRepos(client)

    expect(result).toEqual([
      { repo: expect.objectContaining({ id: 1, fullName: "octocat/Hello-World" }), starredAt: "2026-03-01T00:00:00Z" },
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- lib/github.test.ts
```

Expected: FAIL，提示 `./github` 模块不存在。

- [ ] **Step 3: 实现 github.ts**

`lib/github.ts`:

```ts
import { Octokit } from "@octokit/rest"

export function createGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token })
}

export interface GitHubRepoData {
  id: number
  fullName: string
  name: string
  ownerLogin: string
  ownerAvatar: string | null
  description: string | null
  htmlUrl: string
  language: string | null
  topics: string[]
  stargazersCount: number
  forksCount: number
  archived: boolean
  fork: boolean
  private: boolean
  isTemplate: boolean
  pushedAt: string | null
  updatedAt: string | null
  createdAt: string | null
}

interface RawGitHubRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string; avatar_url?: string | null }
  description?: string | null
  html_url: string
  language?: string | null
  topics?: string[]
  stargazers_count?: number
  forks_count?: number
  archived?: boolean
  fork?: boolean
  private?: boolean
  is_template?: boolean
  pushed_at?: string | null
  updated_at?: string | null
  created_at?: string | null
}

function mapRepo(raw: RawGitHubRepo): GitHubRepoData {
  return {
    id: raw.id,
    fullName: raw.full_name,
    name: raw.name,
    ownerLogin: raw.owner.login,
    ownerAvatar: raw.owner.avatar_url ?? null,
    description: raw.description ?? null,
    htmlUrl: raw.html_url,
    language: raw.language ?? null,
    topics: raw.topics ?? [],
    stargazersCount: raw.stargazers_count ?? 0,
    forksCount: raw.forks_count ?? 0,
    archived: Boolean(raw.archived),
    fork: Boolean(raw.fork),
    private: Boolean(raw.private),
    isTemplate: Boolean(raw.is_template),
    pushedAt: raw.pushed_at ?? null,
    updatedAt: raw.updated_at ?? null,
    createdAt: raw.created_at ?? null,
  }
}

export async function listOwnedRepos(client: Octokit): Promise<GitHubRepoData[]> {
  const raw = (await client.paginate(client.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    affiliation: "owner",
  })) as RawGitHubRepo[]
  return raw.map(mapRepo)
}

export interface StarredRepoData {
  repo: GitHubRepoData
  starredAt: string
}

export async function listStarredRepos(client: Octokit): Promise<StarredRepoData[]> {
  const raw = (await client.paginate(client.rest.activity.listReposStarredByAuthenticatedUser, {
    per_page: 100,
    headers: { accept: "application/vnd.github.star+json" },
  })) as unknown as Array<{ starred_at: string; repo: RawGitHubRepo }>
  return raw.map((entry) => ({ repo: mapRepo(entry.repo), starredAt: entry.starred_at }))
}

export async function starRepo(client: Octokit, owner: string, repo: string): Promise<void> {
  await client.rest.activity.starRepoForAuthenticatedUser({ owner, repo })
}

export async function unstarRepo(client: Octokit, owner: string, repo: string): Promise<void> {
  await client.rest.activity.unstarRepoForAuthenticatedUser({ owner, repo })
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- lib/github.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/github.ts lib/github.test.ts
git commit -m "添加 GitHub API 封装：列表/star/unstar"
```

---

### Task 7: 同步逻辑（merge + 整表 upsert）

**Files:**
- Create: `lib/db/sync.ts`
- Test: `lib/db/sync.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `./client`（Task 2）；`repos` from `./schema`（Task 2）；`GitHubRepoData`, `StarredRepoData` from `../github`（Task 6）。
- Produces: `syncRepos(db, input: SyncInput): SyncResult`，类型 `SyncInput { owned: GitHubRepoData[]; starred: StarredRepoData[] }` 和 `SyncResult { ownedCount: number; starredCount: number }`。Task 8（POST /api/sync）依赖这些名称。这是设计文档"同步机制"那条核心规则（未出现的旧记录置 0，但绝不删除 `repo_user_data`）的唯一实现位置，测试要重点覆盖这条规则。

- [ ] **Step 1: 写测试**

`lib/db/sync.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { createDb } from "./client"
import { repos, repoUserData } from "./schema"
import { syncRepos } from "./sync"
import type { GitHubRepoData } from "../github"

function makeRepo(overrides: Partial<GitHubRepoData> = {}): GitHubRepoData {
  return {
    id: 1,
    fullName: "octocat/Hello-World",
    name: "Hello-World",
    ownerLogin: "octocat",
    ownerAvatar: null,
    description: null,
    htmlUrl: "https://github.com/octocat/Hello-World",
    language: "TypeScript",
    topics: [],
    stargazersCount: 0,
    forksCount: 0,
    archived: false,
    fork: false,
    private: false,
    isTemplate: false,
    pushedAt: null,
    updatedAt: null,
    createdAt: null,
    ...overrides,
  }
}

describe("syncRepos", () => {
  it("marks owned repos with is_owned = 1 and is_starred = 0", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo()], starred: [] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isOwned).toBe(1)
    expect(row.isStarred).toBe(0)
  })

  it("marks a repo as both owned and starred when it appears in both lists", () => {
    const db = createDb(":memory:")
    syncRepos(db, {
      owned: [makeRepo()],
      starred: [{ repo: makeRepo(), starredAt: "2026-01-01T00:00:00Z" }],
    })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isOwned).toBe(1)
    expect(row.isStarred).toBe(1)
    expect(row.starredAt).toBe("2026-01-01T00:00:00Z")
  })

  it("resets is_owned/is_starred for repos missing from a later sync, without touching repo_user_data", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [makeRepo({ id: 1 })], starred: [] })
    db.insert(repoUserData).values({ repoId: 1, isFavorite: 1, note: "记得看看" }).run()

    syncRepos(db, { owned: [], starred: [] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isOwned).toBe(0)
    expect(row.isStarred).toBe(0)

    const userData = db.select().from(repoUserData).where(eq(repoUserData.repoId, 1)).get()!
    expect(userData.isFavorite).toBe(1)
    expect(userData.note).toBe("记得看看")
  })

  it("re-flags a repo back to 1 if it reappears in a subsequent sync", () => {
    const db = createDb(":memory:")
    syncRepos(db, { owned: [], starred: [{ repo: makeRepo({ id: 1 }), starredAt: "2026-01-01T00:00:00Z" }] })
    syncRepos(db, { owned: [], starred: [] })
    syncRepos(db, { owned: [], starred: [{ repo: makeRepo({ id: 1 }), starredAt: "2026-02-01T00:00:00Z" }] })

    const row = db.select().from(repos).where(eq(repos.id, 1)).get()!
    expect(row.isStarred).toBe(1)
    expect(row.starredAt).toBe("2026-02-01T00:00:00Z")
  })

  it("returns counts matching the input lists", () => {
    const db = createDb(":memory:")
    const result = syncRepos(db, {
      owned: [makeRepo({ id: 1 }), makeRepo({ id: 2, fullName: "octocat/Spoon-Knife", name: "Spoon-Knife" })],
      starred: [{ repo: makeRepo({ id: 3, fullName: "octocat/Other", name: "Other" }), starredAt: "2026-01-01T00:00:00Z" }],
    })

    expect(result).toEqual({ ownedCount: 2, starredCount: 1 })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test -- lib/db/sync.test.ts
```

Expected: FAIL，提示 `./sync` 模块不存在。

- [ ] **Step 3: 实现 sync.ts**

`lib/db/sync.ts`:

```ts
import type { AppDatabase } from "./client"
import { repos } from "./schema"
import type { GitHubRepoData, StarredRepoData } from "../github"

export interface SyncInput {
  owned: GitHubRepoData[]
  starred: StarredRepoData[]
}

export interface SyncResult {
  ownedCount: number
  starredCount: number
}

interface MergedEntry {
  repo: GitHubRepoData
  isOwned: boolean
  isStarred: boolean
  starredAt: string | null
}

export function syncRepos(db: AppDatabase, input: SyncInput): SyncResult {
  const merged = new Map<number, MergedEntry>()

  for (const repo of input.owned) {
    merged.set(repo.id, { repo, isOwned: true, isStarred: false, starredAt: null })
  }
  for (const { repo, starredAt } of input.starred) {
    const existing = merged.get(repo.id)
    merged.set(repo.id, {
      repo,
      isOwned: existing?.isOwned ?? false,
      isStarred: true,
      starredAt,
    })
  }

  const now = new Date().toISOString()

  db.transaction((tx) => {
    tx.update(repos).set({ isOwned: 0, isStarred: 0, starredAt: null }).run()

    for (const entry of merged.values()) {
      const values = {
        id: entry.repo.id,
        fullName: entry.repo.fullName,
        name: entry.repo.name,
        ownerLogin: entry.repo.ownerLogin,
        ownerAvatar: entry.repo.ownerAvatar,
        description: entry.repo.description,
        htmlUrl: entry.repo.htmlUrl,
        language: entry.repo.language,
        topics: JSON.stringify(entry.repo.topics),
        stargazersCount: entry.repo.stargazersCount,
        forksCount: entry.repo.forksCount,
        archived: entry.repo.archived ? 1 : 0,
        fork: entry.repo.fork ? 1 : 0,
        private: entry.repo.private ? 1 : 0,
        isTemplate: entry.repo.isTemplate ? 1 : 0,
        pushedAt: entry.repo.pushedAt,
        updatedAt: entry.repo.updatedAt,
        createdAt: entry.repo.createdAt,
        isOwned: entry.isOwned ? 1 : 0,
        isStarred: entry.isStarred ? 1 : 0,
        starredAt: entry.starredAt,
        syncedAt: now,
      }

      tx.insert(repos).values(values).onConflictDoUpdate({ target: repos.id, set: values }).run()
    }
  })

  return { ownedCount: input.owned.length, starredCount: input.starred.length }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test -- lib/db/sync.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 运行全部数据层测试，确认彼此无干扰**

```bash
npm run test
```

Expected: 全部 PASS（覆盖 Task 2-7 共 6 个测试文件）。

- [ ] **Step 6: Commit**

```bash
git add lib/db/sync.ts lib/db/sync.test.ts
git commit -m "实现同步逻辑：合并 owned/starred 并整表 upsert，保留用户数据"
```

---

## API 路由（Task 8-12）

以下任务实现 `app/api/*` Route Handlers。按设计文档"测试策略"的约定，API 路由不写自动化测试，用 `npm run dev`（端口 6602，见 `package.json` 的 `dev` 脚本）启动后用 `curl` 手动验证——这是这些路由的真实集成边界（连到真实 SQLite 文件 + 真实 GitHub API），自动化 mock 测试的收益低于手动一次性验证。

在执行 Task 8 之前，先在 `.env.local` 里配置一个真实的 `GITHUB_TOKEN`（复制 `.env.local.example` 并填入你自己的 GitHub Personal Access Token，至少需要 `repo` 和 `read:user` 权限范围以支持读取仓库列表、star/unstar）。

### Task 8: POST /api/sync

**Files:**
- Create: `app/api/sync/route.ts`

**Interfaces:**
- Consumes: `createGitHubClient`, `listOwnedRepos`, `listStarredRepos` from `@/lib/github`（Task 6）；`db` from `@/lib/db/client`（Task 2）；`syncRepos` from `@/lib/db/sync`（Task 7）。
- Produces: `POST /api/sync` 端点，成功返回 `{ ownedCount: number; starredCount: number }`。Task 17（RepoList 的"同步"按钮）依赖这个端点的 URL 和返回结构。

- [ ] **Step 1: 实现 route.ts**

`app/api/sync/route.ts`:

```ts
import { NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { syncRepos } from "@/lib/db/sync"
import { createGitHubClient, listOwnedRepos, listStarredRepos } from "@/lib/github"

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

- [ ] **Step 2: 手动验证 — 缺 token 时返回 401**

临时把 `.env.local` 里的 `GITHUB_TOKEN` 注释掉（或确认还没配置），启动 dev server：

```bash
npm run dev
```

另开一个终端：

```bash
curl -i -X POST http://localhost:6602/api/sync
```

Expected: HTTP 状态 401，body 包含 `"GITHUB_TOKEN 未配置"`。

- [ ] **Step 3: 手动验证 — 配置真实 token 后同步成功**

在 `.env.local` 填入真实 `GITHUB_TOKEN`，重启 dev server，再次执行：

```bash
curl -i -X POST http://localhost:6602/api/sync
```

Expected: HTTP 200，body 形如 `{"ownedCount":<N>,"starredCount":<M>}`，且 `data/app.db` 文件被创建。可用以下命令抽查数据确实写入了：

```bash
sqlite3 data/app.db "SELECT count(*) FROM repos;"
```

Expected: 返回的数字等于 `ownedCount + starredCount`（或更少，如果有仓库同时 owned 又 starred）。

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "添加 POST /api/sync：拉取 GitHub 数据并同步到本地缓存"
```

---

### Task 9: GET /api/repos

**Files:**
- Create: `app/api/repos/route.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`（Task 2）；`listRepos`, `listDistinctLanguages`, `type ListReposParams` from `@/lib/db/repos`（Task 3）。
- Produces: `GET /api/repos?source=owned|starred&...` 端点，返回 `{ items, total, page, perPage, languages }`。Task 17（RepoList 数据获取）依赖这个端点的 URL、query 参数名（`source`/`search`/`type`/`language`/`sort`/`favorite`/`note`/`tagId`/`page`/`perPage`）和响应结构。

- [ ] **Step 1: 实现 route.ts**

`app/api/repos/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { listRepos, listDistinctLanguages, type ListReposParams } from "@/lib/db/repos"

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const source = sp.get("source")
  if (source !== "owned" && source !== "starred") {
    return NextResponse.json({ error: "source 参数必须是 owned 或 starred" }, { status: 400 })
  }

  const tagIdParam = sp.get("tagId")
  const params: ListReposParams = {
    source,
    search: sp.get("search") ?? undefined,
    type: (sp.get("type") as ListReposParams["type"]) ?? "all",
    language: sp.get("language") ?? undefined,
    sort: (sp.get("sort") as ListReposParams["sort"]) ?? "updated",
    favorite: (sp.get("favorite") as ListReposParams["favorite"]) ?? "all",
    note: (sp.get("note") as ListReposParams["note"]) ?? "all",
    tagId: tagIdParam === "untagged" ? "untagged" : tagIdParam ? Number(tagIdParam) : undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    perPage: sp.get("perPage") ? Number(sp.get("perPage")) : undefined,
  }

  const result = listRepos(db, params)
  const languages = listDistinctLanguages(db, source)
  return NextResponse.json({ ...result, languages })
}
```

- [ ] **Step 2: 手动验证**

确保 Task 8 的同步已经跑过至少一次（`data/app.db` 里有数据），启动 dev server 后执行：

```bash
curl -s "http://localhost:6602/api/repos?source=owned&page=1" | head -c 500
```

Expected: HTTP 200，JSON 里能看到 `items`（数组）、`total`、`page: 1`、`perPage: 30`、`languages`（数组）。

```bash
curl -s "http://localhost:6602/api/repos?source=owned&type=forks" | head -c 500
curl -s "http://localhost:6602/api/repos?source=starred&sort=starred_at" | head -c 500
curl -i "http://localhost:6602/api/repos"
```

Expected：第一条只返回 fork 仓库；第二条按 star 时间排序；第三条（缺 `source`）返回 400。

- [ ] **Step 3: Commit**

```bash
git add app/api/repos/route.ts
git commit -m "添加 GET /api/repos：筛选/排序/分页查询入口"
```

---

### Task 10: PATCH /api/repos/[id]/favorite 与 PATCH /api/repos/[id]/note

**Files:**
- Create: `app/api/repos/[id]/favorite/route.ts`
- Create: `app/api/repos/[id]/note/route.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`（Task 2）；`setFavorite`, `setNote` from `@/lib/db/user-data`（Task 5）。
- Produces: `PATCH /api/repos/:id/favorite`（body `{ isFavorite: boolean }`）、`PATCH /api/repos/:id/note`（body `{ note: string }`），均返回更新后的字段。Task 17（RepoList 的 `handleToggleFavorite`/`handleSaveNote`）依赖这两个 URL 和 body 形状。

- [ ] **Step 1: 实现 favorite/route.ts**

`app/api/repos/[id]/favorite/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { setFavorite } from "@/lib/db/user-data"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.isFavorite !== "boolean") {
    return NextResponse.json({ error: "isFavorite 必须是 boolean" }, { status: 400 })
  }

  setFavorite(db, repoId, body.isFavorite)
  return NextResponse.json({ id: repoId, isFavorite: body.isFavorite })
}
```

- [ ] **Step 2: 实现 note/route.ts**

`app/api/repos/[id]/note/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { setNote } from "@/lib/db/user-data"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.note !== "string") {
    return NextResponse.json({ error: "note 必须是字符串" }, { status: 400 })
  }

  setNote(db, repoId, body.note)
  return NextResponse.json({ id: repoId, note: body.note })
}
```

- [ ] **Step 3: 手动验证**

先从 `GET /api/repos?source=owned` 的结果里拿一个真实的 `id`（下面用 `123` 代替）：

```bash
curl -i -X PATCH http://localhost:6602/api/repos/123/favorite \
  -H "Content-Type: application/json" -d '{"isFavorite": true}'

curl -i -X PATCH http://localhost:6602/api/repos/123/note \
  -H "Content-Type: application/json" -d '{"note": "值得深入研究"}'

curl -s "http://localhost:6602/api/repos?source=owned&favorite=favorite" | head -c 300
curl -s "http://localhost:6602/api/repos?source=owned&note=noted" | head -c 300
```

Expected: 前两条返回 200 和对应字段；后两条的结果里都能看到 id 为 123 的那条记录。

- [ ] **Step 4: Commit**

```bash
git add app/api/repos/\[id\]/favorite/route.ts app/api/repos/\[id\]/note/route.ts
git commit -m "添加收藏/备注的 PATCH 路由"
```

---

### Task 11: GET/POST /api/tags 与 GET/PUT /api/repos/[id]/tags

**Files:**
- Create: `app/api/tags/route.ts`
- Create: `app/api/repos/[id]/tags/route.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`（Task 2）；`listTags`, `createTag`, `getRepoTags`, `setRepoTags` from `@/lib/db/tags`（Task 4）。
- Produces: `GET /api/tags` → `{ tags: TagOption[] }`；`POST /api/tags`（body `{ name: string }`）→ 新建的 `TagOption`；`GET /api/repos/:id/tags` → `{ tags: TagOption[] }`；`PUT /api/repos/:id/tags`（body `{ tagNames: string[] }`）→ `{ tags: TagOption[] }`。Task 13（TagSelect 选项数据）、Task 17（RepoList 的 `handleChangeTags`）依赖这些 URL 和 body 形状。

- [ ] **Step 1: 实现 tags/route.ts**

`app/api/tags/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { listTags, createTag } from "@/lib/db/tags"

export async function GET() {
  return NextResponse.json({ tags: listTags(db) })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 })
  }

  const tag = createTag(db, body.name.trim())
  return NextResponse.json(tag, { status: 201 })
}
```

- [ ] **Step 2: 实现 repos/[id]/tags/route.ts**

`app/api/repos/[id]/tags/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db/client"
import { getRepoTags, setRepoTags } from "@/lib/db/tags"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  return NextResponse.json({ tags: getRepoTags(db, repoId) })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (!Array.isArray(body.tagNames)) {
    return NextResponse.json({ error: "tagNames 必须是字符串数组" }, { status: 400 })
  }

  const tags = setRepoTags(db, repoId, body.tagNames)
  return NextResponse.json({ tags })
}
```

- [ ] **Step 3: 手动验证**

```bash
curl -i -X POST http://localhost:6602/api/tags -H "Content-Type: application/json" -d '{"name": "cli-tools"}'
curl -s http://localhost:6602/api/tags

curl -i -X PUT http://localhost:6602/api/repos/123/tags \
  -H "Content-Type: application/json" -d '{"tagNames": ["cli-tools", "to-read"]}'
curl -s http://localhost:6602/api/repos/123/tags

curl -s "http://localhost:6602/api/repos?source=owned&tagId=untagged" | head -c 300
```

Expected: 创建/查询 tag 成功；repo 123 关联上两个标签；最后一条结果里不包含 repo 123（因为它现在已经打标）。

- [ ] **Step 4: Commit**

```bash
git add app/api/tags/route.ts app/api/repos/\[id\]/tags/route.ts
git commit -m "添加标签管理与 repo-标签关联的路由"
```

---

### Task 12: PUT/DELETE /api/repos/[id]/star

**Files:**
- Create: `app/api/repos/[id]/star/route.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`（Task 2）；`repos` from `@/lib/db/schema`（Task 2）；`setStarred` from `@/lib/db/repos`（Task 3）；`createGitHubClient`, `starRepo`, `unstarRepo` from `@/lib/github`（Task 6）。
- Produces: `PUT /api/repos/:id/star` 和 `DELETE /api/repos/:id/star`，都返回 `{ id: number; isStarred: boolean }`。Task 17（RepoList 的 `handleToggleStar`）依赖这两个 URL。

- [ ] **Step 1: 实现 route.ts**

`app/api/repos/[id]/star/route.ts`:

```ts
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
```

- [ ] **Step 2: 手动验证**

挑一个你确实想 star/unstar 的真实仓库 id（注意：这会真实修改你 GitHub 账号上的 star 状态，建议用一个无关紧要的小仓库测试，比如 `octocat/Spoon-Knife`，测完记得用反操作还原）：

```bash
curl -i -X PUT http://localhost:6602/api/repos/<id>/star
curl -s "http://localhost:6602/api/repos?source=starred" | head -c 300

curl -i -X DELETE http://localhost:6602/api/repos/<id>/star
```

Expected: PUT 后返回 `{"id":<id>,"isStarred":true}`，且该仓库出现在 `/stars` 的查询结果里；DELETE 后返回 `isStarred:false`；同时在浏览器打开 `https://github.com/<owner>/<repo>` 确认 Star 按钮状态确实跟随变化（验证写操作真的打到了 GitHub，不是只改了本地缓存）。

- [ ] **Step 3: Commit**

```bash
git add app/api/repos/\[id\]/star/route.ts
git commit -m "添加 star/unstar 路由：代理 GitHub 写操作并同步本地标记"
```

---

## 前端组件与页面（Task 13-19）

以下任务全是客户端组件（`"use client"`），按设计文档"测试策略"的约定不写自动化测试。每个任务做完后用 `npm run dev` 在浏览器里实际点一遍交互确认行为正确——这是系统级要求（UI 改动必须过浏览器验证），不是可选项。

### Task 13: TagSelect 组件

**Files:**
- Create: `app/components/TagSelect.tsx`

**Interfaces:**
- Produces: `TagSelect` 组件（受控、不直接调用任何 API），`TagOption { id: number; name: string }` 类型。Task 15（RepoCard）、Task 16（FilterBar）都会 import `TagOption`。

- [ ] **Step 1: 实现组件**

`app/components/TagSelect.tsx`:

```tsx
"use client"

import { Select } from "antd"

export interface TagOption {
  id: number
  name: string
}

interface TagSelectProps {
  allTags: TagOption[]
  value: string[]
  onChange: (tagNames: string[]) => void
}

export default function TagSelect({ allTags, value, onChange }: TagSelectProps) {
  return (
    <Select
      mode="tags"
      size="small"
      style={{ minWidth: 160 }}
      placeholder="添加标签"
      value={value}
      options={allTags.map((tag) => ({ label: tag.name, value: tag.name }))}
      onChange={(next) => onChange(next as string[])}
    />
  )
}
```

- [ ] **Step 2: 临时挂载到首页手动验证**

在 `app/page.tsx`（现在还是 create-next-app 默认首页，Task 18 会替换它）里临时加一段调用 `TagSelect` 的代码，确认：① 下拉框能展示传入的 `allTags`；② 输入一个不在列表里的名称按 Enter 能新建并选中；③ `onChange` 触发时打印出的 `tagNames` 数组符合预期。验证完成后撤销这段临时代码（不要提交）。

```bash
npm run dev
```

打开 `http://localhost:6602` 手动操作确认。

- [ ] **Step 3: Commit**

```bash
git add app/components/TagSelect.tsx
git commit -m "添加 TagSelect 组件：标签多选与新建"
```

---

### Task 14: NoteEditor 组件

**Files:**
- Create: `app/components/NoteEditor.tsx`

**Interfaces:**
- Produces: `NoteEditor` 组件，props `{ note: string | null; onSave: (note: string) => Promise<void> }`。Task 15（RepoCard）依赖这个组件。

- [ ] **Step 1: 实现组件**

`app/components/NoteEditor.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button, Input, Popover } from "antd"
import { EditOutlined, FileTextOutlined } from "@ant-design/icons"

interface NoteEditorProps {
  note: string | null
  onSave: (note: string) => Promise<void>
}

export default function NoteEditor({ note, onSave }: NoteEditorProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(note ?? "")
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(note ?? "")
    setOpen(next)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger="click"
      content={
        <div style={{ width: 280 }}>
          <Input.TextArea
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="添加备注..."
          />
          <Button type="primary" size="small" style={{ marginTop: 8 }} loading={saving} onClick={handleSave}>
            保存
          </Button>
        </div>
      }
    >
      <Button
        type="text"
        size="small"
        icon={note ? <FileTextOutlined style={{ color: "#1677ff" }} /> : <EditOutlined />}
      />
    </Popover>
  )
}
```

- [ ] **Step 2: 手动验证**

同 Task 13，在 `app/page.tsx` 临时挂载 `NoteEditor`，传入一个假的 `onSave`（`async (note) => console.log(note)`），确认：① 点击图标弹出编辑框；② 编辑框默认值是当前 `note`；③ 输入后点"保存"会触发 `onSave` 并关闭弹窗；④ 重新打开时草稿被重置为最新的 `note`（不是上次未保存的草稿）。验证完撤销临时代码。

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add app/components/NoteEditor.tsx
git commit -m "添加 NoteEditor 组件：备注查看与编辑"
```

---

### Task 15: RepoCard 组件

**Files:**
- Create: `app/components/RepoCard.tsx`

**Interfaces:**
- Consumes: `TagSelect`, `type TagOption` from `./TagSelect`（Task 13）；`NoteEditor` from `./NoteEditor`（Task 14）。
- Produces: `RepoCard` 组件，props 见下方代码（`RepoCardData` 与 Task 3 的 `RepoListItem` 字段名完全一致，调用方可以直接把 API 返回的条目传进来）。所有写操作通过回调 props 暴露，不在组件内部直接 fetch——这样组件本身保持纯展示+受控，方便复用。Task 17（RepoList）依赖这个组件。

- [ ] **Step 1: 实现组件**

`app/components/RepoCard.tsx`:

```tsx
"use client"

import { Card, Space, Tag as AntTag, Typography } from "antd"
import { ForkOutlined, HeartFilled, HeartOutlined, StarFilled, StarOutlined } from "@ant-design/icons"
import TagSelect, { type TagOption } from "./TagSelect"
import NoteEditor from "./NoteEditor"

const { Text, Paragraph, Link } = Typography

export interface RepoCardData {
  id: number
  fullName: string
  description: string | null
  htmlUrl: string
  language: string | null
  stargazersCount: number
  forksCount: number
  archived: boolean
  fork: boolean
  isOwned: boolean
  isStarred: boolean
  isFavorite: boolean
  note: string | null
  tags: TagOption[]
}

interface RepoCardProps {
  repo: RepoCardData
  allTags: TagOption[]
  onToggleFavorite: (id: number, next: boolean) => Promise<void>
  onToggleStar: (id: number, next: boolean) => Promise<void>
  onSaveNote: (id: number, note: string) => Promise<void>
  onChangeTags: (id: number, tagNames: string[]) => Promise<void>
}

export default function RepoCard({
  repo,
  allTags,
  onToggleFavorite,
  onToggleStar,
  onSaveNote,
  onChangeTags,
}: RepoCardProps) {
  return (
    <Card size="small" style={{ height: "100%" }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
          <Link href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" strong>
            {repo.fullName}
          </Link>
          <Space size={4}>
            <a onClick={() => onToggleFavorite(repo.id, !repo.isFavorite)}>
              {repo.isFavorite ? <HeartFilled style={{ color: "#eb2f96" }} /> : <HeartOutlined />}
            </a>
            <a onClick={() => onToggleStar(repo.id, !repo.isStarred)}>
              {repo.isStarred ? <StarFilled style={{ color: "#fadb14" }} /> : <StarOutlined />}
            </a>
            <NoteEditor note={repo.note} onSave={(note) => onSaveNote(repo.id, note)} />
          </Space>
        </Space>

        {repo.description && (
          <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
            {repo.description}
          </Paragraph>
        )}

        <Space size={12}>
          {repo.language && <Text type="secondary">{repo.language}</Text>}
          <Text type="secondary">
            <StarOutlined /> {repo.stargazersCount}
          </Text>
          <Text type="secondary">
            <ForkOutlined /> {repo.forksCount}
          </Text>
          {repo.archived && <AntTag>Archived</AntTag>}
          {repo.fork && <AntTag>Fork</AntTag>}
        </Space>

        <TagSelect
          allTags={allTags}
          value={repo.tags.map((t) => t.name)}
          onChange={(tagNames) => onChangeTags(repo.id, tagNames)}
        />
      </Space>
    </Card>
  )
}
```

- [ ] **Step 2: 手动验证**

在 `app/page.tsx` 临时挂载一个写死数据的 `RepoCard`（`repo` 用假数据，4 个回调都用 `async (...) => console.log(...)`），确认：① 卡片信息（名称/描述/语言/star 数/fork 数/Archived 标签）正确展示；② 点击收藏/star 图标会触发对应回调并打印参数；③ 备注图标弹出 NoteEditor；④ 底部 TagSelect 正常工作。验证完撤销临时代码。

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add app/components/RepoCard.tsx
git commit -m "添加 RepoCard 组件：仓库信息展示与收藏/star/备注/标签交互"
```

---

### Task 16: FilterBar 组件

**Files:**
- Create: `app/components/FilterBar.tsx`

**Interfaces:**
- Consumes: `type TagOption` from `./TagSelect`（Task 13）。
- Produces: `FilterBar` 组件，类型 `FilterValues`（字段名与 Task 9 的 `GET /api/repos` query 参数名一一对应：`search`/`type`/`language`/`sort`/`favorite`/`note`/`tag`）。Task 17（RepoList）依赖这个类型和组件。

- [ ] **Step 1: 实现组件**

`app/components/FilterBar.tsx`:

```tsx
"use client"

import { Input, Select, Space } from "antd"
import type { TagOption } from "./TagSelect"

export interface FilterValues {
  search: string
  type: "all" | "sources" | "forks" | "archived" | "templates"
  language: string
  sort: "updated" | "name" | "stars" | "starred_at"
  favorite: "all" | "favorite" | "not_favorite"
  note: "all" | "noted" | "not_noted"
  tag: string
}

interface FilterBarProps {
  value: FilterValues
  languages: string[]
  tags: TagOption[]
  showStarredSort: boolean
  onChange: (next: FilterValues) => void
}

const TYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Sources", value: "sources" },
  { label: "Forks", value: "forks" },
  { label: "Archived", value: "archived" },
  { label: "Templates", value: "templates" },
]

const FAVORITE_OPTIONS = [
  { label: "收藏：全部", value: "all" },
  { label: "已收藏", value: "favorite" },
  { label: "未收藏", value: "not_favorite" },
]

const NOTE_OPTIONS = [
  { label: "备注：全部", value: "all" },
  { label: "已备注", value: "noted" },
  { label: "未备注", value: "not_noted" },
]

export default function FilterBar({ value, languages, tags, showStarredSort, onChange }: FilterBarProps) {
  const sortOptions = [
    { label: "Last updated", value: "updated" },
    { label: "Name", value: "name" },
    { label: "Stars", value: "stars" },
    ...(showStarredSort ? [{ label: "Recently starred", value: "starred_at" }] : []),
  ]

  const tagOptions = [
    { label: "标签：全部", value: "all" },
    { label: "未打标", value: "untagged" },
    ...tags.map((tag) => ({ label: tag.name, value: String(tag.id) })),
  ]

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search
        placeholder="Find a repository..."
        allowClear
        defaultValue={value.search}
        onSearch={(search) => onChange({ ...value, search })}
        style={{ width: 220 }}
      />
      <Select
        value={value.type}
        options={TYPE_OPTIONS}
        style={{ width: 140 }}
        onChange={(type) => onChange({ ...value, type })}
      />
      <Select
        value={value.language}
        options={[{ label: "语言：全部", value: "all" }, ...languages.map((lang) => ({ label: lang, value: lang }))]}
        style={{ width: 160 }}
        onChange={(language) => onChange({ ...value, language })}
      />
      <Select
        value={value.sort}
        options={sortOptions}
        style={{ width: 160 }}
        onChange={(sort) => onChange({ ...value, sort })}
      />
      <Select
        value={value.favorite}
        options={FAVORITE_OPTIONS}
        style={{ width: 140 }}
        onChange={(favorite) => onChange({ ...value, favorite })}
      />
      <Select
        value={value.note}
        options={NOTE_OPTIONS}
        style={{ width: 140 }}
        onChange={(note) => onChange({ ...value, note })}
      />
      <Select
        value={value.tag}
        options={tagOptions}
        style={{ width: 160 }}
        onChange={(tag) => onChange({ ...value, tag })}
      />
    </Space>
  )
}
```

- [ ] **Step 2: 手动验证**

在 `app/page.tsx` 临时挂载 `FilterBar`（用 `useState` 管理 `value`，`languages`/`tags` 用假数据，`onChange` 更新 state 并打印），确认每个下拉框/搜索框切换后 `onChange` 收到的对象字段正确，`showStarredSort=true` 时能看到"Recently starred"选项、`false` 时看不到。验证完撤销临时代码。

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add app/components/FilterBar.tsx
git commit -m "添加 FilterBar 组件：复刻 GitHub 筛选 + 本工具自有筛选"
```

---

### Task 17: RepoList 组件（数据获取 + URL 状态 + 同步按钮）

**Files:**
- Create: `app/components/RepoList.tsx`

**Interfaces:**
- Consumes: `FilterBar`, `type FilterValues` from `./FilterBar`（Task 16）；`RepoCard`, `type RepoCardData` from `./RepoCard`（Task 15）；`type TagOption` from `./TagSelect`（Task 13）；`GET/PUT /api/repos`, `/api/tags`, `/api/repos/[id]/favorite`, `/api/repos/[id]/note`, `/api/repos/[id]/tags`, `/api/repos/[id]/star`, `POST /api/sync`（Task 8-12）。
- Produces: `RepoList` 组件，props `{ source: "owned" | "starred" }`。Task 18（两个页面）依赖这个组件。

- [ ] **Step 1: 实现组件**

`app/components/RepoList.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button, Col, Pagination, Row, Spin, message } from "antd"
import { SyncOutlined } from "@ant-design/icons"
import FilterBar, { type FilterValues } from "./FilterBar"
import RepoCard, { type RepoCardData } from "./RepoCard"
import type { TagOption } from "./TagSelect"

interface RepoListProps {
  source: "owned" | "starred"
}

interface ReposResponse {
  items: RepoCardData[]
  total: number
  page: number
  perPage: number
  languages: string[]
}

const DEFAULT_FILTERS: FilterValues = {
  search: "",
  type: "all",
  language: "all",
  sort: "updated",
  favorite: "all",
  note: "all",
  tag: "all",
}

function filtersFromSearchParams(sp: URLSearchParams): FilterValues {
  return {
    search: sp.get("search") ?? DEFAULT_FILTERS.search,
    type: (sp.get("type") as FilterValues["type"]) ?? DEFAULT_FILTERS.type,
    language: sp.get("language") ?? DEFAULT_FILTERS.language,
    sort: (sp.get("sort") as FilterValues["sort"]) ?? DEFAULT_FILTERS.sort,
    favorite: (sp.get("favorite") as FilterValues["favorite"]) ?? DEFAULT_FILTERS.favorite,
    note: (sp.get("note") as FilterValues["note"]) ?? DEFAULT_FILTERS.note,
    tag: sp.get("tag") ?? DEFAULT_FILTERS.tag,
  }
}

export default function RepoList({ source }: RepoListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const page = Number(searchParams.get("page") ?? "1")

  const [data, setData] = useState<ReposResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [allTags, setAllTags] = useState<TagOption[]>([])

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/tags")
    const json = await res.json()
    setAllTags(json.tags)
  }, [])

  const fetchRepos = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        source,
        page: String(page),
        search: filters.search,
        type: filters.type,
        language: filters.language,
        sort: filters.sort,
        favorite: filters.favorite,
        note: filters.note,
      })
      if (filters.tag === "untagged") {
        qs.set("tagId", "untagged")
      } else if (filters.tag !== "all") {
        qs.set("tagId", filters.tag)
      }

      const res = await fetch(`/api/repos?${qs.toString()}`)
      const json = await res.json()
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [source, page, filters])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const updateFilters = (next: FilterValues) => {
    const qs = new URLSearchParams({ ...next, page: "1" })
    router.push(`?${qs.toString()}`)
  }

  const updatePage = (nextPage: number) => {
    const qs = new URLSearchParams({ ...filters, page: String(nextPage) })
    router.push(`?${qs.toString()}`)
  }

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

  const callAndRefresh = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      message.error(json.error ?? "操作失败")
      return false
    }
    return true
  }

  const handleToggleFavorite = async (id: number, next: boolean) => {
    if (await callAndRefresh(`/api/repos/${id}/favorite`, "PATCH", { isFavorite: next })) {
      fetchRepos()
    }
  }

  const handleToggleStar = async (id: number, next: boolean) => {
    if (await callAndRefresh(`/api/repos/${id}/star`, next ? "PUT" : "DELETE")) {
      fetchRepos()
    }
  }

  const handleSaveNote = async (id: number, note: string) => {
    if (await callAndRefresh(`/api/repos/${id}/note`, "PATCH", { note })) {
      fetchRepos()
    }
  }

  const handleChangeTags = async (id: number, tagNames: string[]) => {
    if (await callAndRefresh(`/api/repos/${id}/tags`, "PUT", { tagNames })) {
      await fetchTags()
      fetchRepos()
    }
  }

  return (
    <div>
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
        <Col>
          <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing}>
            同步
          </Button>
        </Col>
      </Row>

      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          {data?.items.map((repo) => (
            <Col key={repo.id} xs={24} sm={12} lg={8}>
              <RepoCard
                repo={repo}
                allTags={allTags}
                onToggleFavorite={handleToggleFavorite}
                onToggleStar={handleToggleStar}
                onSaveNote={handleSaveNote}
                onChangeTags={handleChangeTags}
              />
            </Col>
          ))}
        </Row>
      </Spin>

      {data && (
        <Row justify="end" style={{ marginTop: 16 }}>
          <Pagination
            current={data.page}
            pageSize={data.perPage}
            total={data.total}
            onChange={updatePage}
            showSizeChanger={false}
          />
        </Row>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 手动验证**

确保 Task 8 已经同步过真实数据，启动 dev server，在浏览器临时通过 `app/page.tsx`（Task 18 会正式接好路由）渲染 `<RepoList source="owned" />` 和 `<RepoList source="starred" />` 分别验证：

```bash
npm run dev
```

逐项确认：① 列表正确展示，分页点击能翻页且 URL 带上 `page` 参数；② 切换筛选条件（类型/语言/排序/收藏/备注/标签）后列表正确更新且 URL 同步更新、刷新页面筛选状态不丢；③ 点击"同步"按钮触发真实同步并看到成功提示；④ 收藏/star/备注/标签的交互能立即生效并在刷新后保持；⑤ 用浏览器开发者工具切到手机视口宽度（如 375px），确认卡片变成单列、筛选栏可正常换行操作。

- [ ] **Step 3: Commit**

```bash
git add app/components/RepoList.tsx
git commit -m "添加 RepoList 组件：整合筛选/分页/同步与各项写操作"
```

---

### Task 18: 页面与导航

**Files:**
- Create: `app/repos/page.tsx`
- Create: `app/stars/page.tsx`
- Modify: `app/page.tsx`（替换 create-next-app 默认首页）
- Modify: `app/layout.tsx`（加顶部导航，清掉注释掉的 Geist 字体死代码）

**Interfaces:**
- Consumes: `RepoList` from `../components/RepoList`（Task 17）。
- Produces: 路由 `/`（重定向到 `/repos`）、`/repos`、`/stars`，全站导航。这是设计文档"页面结构与路由"那一节的落地，也是 Task 13-17 所有组件第一次被真实页面使用、走通端到端链路的地方。

- [ ] **Step 1: 实现 /repos 页面**

`app/repos/page.tsx`:

```tsx
import { Suspense } from "react"
import RepoList from "../components/RepoList"

export default function ReposPage() {
  return (
    <Suspense>
      <RepoList source="owned" />
    </Suspense>
  )
}
```

- [ ] **Step 2: 实现 /stars 页面**

`app/stars/page.tsx`:

```tsx
import { Suspense } from "react"
import RepoList from "../components/RepoList"

export default function StarsPage() {
  return (
    <Suspense>
      <RepoList source="starred" />
    </Suspense>
  )
}
```

`useSearchParams()`（在 `RepoList` 内部使用）要求调用它的客户端组件被 `<Suspense>` 包裹，否则会在生产构建时报错——这是 Next.js 的硬性要求，不是可选的防御性写法。

- [ ] **Step 3: 替换根路径首页**

`app/page.tsx`（完全替换现有内容）:

```tsx
import { redirect } from "next/navigation"

export default function HomePage() {
  redirect("/repos")
}
```

- [ ] **Step 4: 更新顶部导航布局**

`app/layout.tsx`（完全替换现有内容，去掉之前注释掉的 Geist 字体代码）:

```tsx
import type { Metadata } from "next"
import Link from "next/link"
import { AntdRegistry } from "@ant-design/nextjs-registry"
import { Layout, Menu } from "antd"
import "./globals.css"

export const metadata: Metadata = {
  title: "GitHub Star 管理",
  description: "管理 GitHub 仓库与 Star 的个人工具",
}

const NAV_ITEMS = [
  { key: "/repos", label: <Link href="/repos">我的仓库</Link> },
  { key: "/stars", label: <Link href="/stars">已 Star</Link> },
]

const RootLayout = ({ children }: React.PropsWithChildren) => (
  <html lang="zh-CN">
    <body>
      <AntdRegistry>
        <Layout style={{ minHeight: "100vh" }}>
          <Layout.Header>
            <Menu theme="dark" mode="horizontal" items={NAV_ITEMS} selectable={false} />
          </Layout.Header>
          <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
        </Layout>
      </AntdRegistry>
    </body>
  </html>
)

export default RootLayout
```

- [ ] **Step 5: 删除不再使用的默认素材（可选清理）**

`app/page.tsx` 替换后不再引用 `next/image` 和 `public/*.svg`；`public/file.svg`、`public/vercel.svg`、`public/window.svg`、`app/favicon.ico` 之外的默认素材可以保留不动（不是本次任务范围，避免无关改动），只确认 `npm run build` 不会因为缺图片报错（用 `<Link>` 文本导航，没有引用任何素材文件）。

- [ ] **Step 6: 手动验证端到端流程**

```bash
npm run dev
```

打开浏览器访问 `http://localhost:6602/`，确认：① 自动跳转到 `/repos`；② 顶部导航能切换 `/repos` 和 `/stars`；③ 两个页面都能看到真实仓库数据（如果 Task 8 的同步已经跑过）；④ 按 F12 切换到手机视口，确认导航和列表都正常可用；⑤ 在 `/repos` 和 `/stars` 上各完整走一遍收藏/备注/打标/star-unstar/筛选/分页操作，没有报错。

- [ ] **Step 7: Commit**

```bash
git add app/repos/page.tsx app/stars/page.tsx app/page.tsx app/layout.tsx
git commit -m "接入页面路由与顶部导航：/repos、/stars、根路径重定向"
```

---

### Task 19: 全量验证（类型检查 / lint / 构建 / 需求清单复核）

**Files:**
- 不新增/不修改文件，纯验证任务。

**Interfaces:**
- 无新接口；本任务确认 Task 1-18 的所有产出能一起正常工作，并逐条对照设计文档"需求范围"小节的 9 条原始需求验收。

- [ ] **Step 1: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 无报错。

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: 无报错（如有 antd 相关的 ESLint 警告，按提示修复后再继续）。

- [ ] **Step 3: 全部单测**

```bash
npm run test
```

Expected: Task 2-7 共 6 个测试文件全部 PASS。

- [ ] **Step 4: 生产构建**

```bash
npm run build
```

Expected: 构建成功，没有因为 `better-sqlite3` 原生模块或 Route Handler 的 `params`/`searchParams` Promise 用法报错。

- [ ] **Step 5: 按原始需求逐条手动验收**

启动 `npm run build && npm run start`（或继续用 `npm run dev`），在浏览器里逐条对照设计文档"需求范围"小节验收：

1. 用浏览器开发者工具切换到手机视口宽度，确认 `/repos`、`/stars` 都能正常浏览操作（移动端响应式）。
2. `/repos` 展示的是 owned 仓库，`/stars` 展示的是 starred 仓库，两者数据不同。
3. 列表底部分页控件能正常翻页。
4. 筛选栏的类型/语言/排序/搜索框筛选结果符合预期，且行为接近 github.com 上对应页面的筛选。
5. 给一个仓库选择已有标签 + 新建一个标签，刷新页面后标签仍然保留。
6. 给一个仓库点击收藏图标，再点击取消，状态正确切换且刷新后保留。
7. 给一个仓库添加备注、编辑备注，刷新后备注保留。
8. 用收藏/备注/标签筛选条件分别验证：筛选结果只包含符合条件的仓库。
9. 对一个仓库执行 star，再执行 unstar，确认 GitHub 网页上的 star 状态确实跟随变化（不是只改了本地缓存）。

- [ ] **Step 6: Commit（如果验收过程中有修复性改动）**

如果 Step 1-5 发现并修复了问题，提交修复：

```bash
git add -A
git commit -m "修复全量验证中发现的问题"
```

如果验收全部通过且没有任何代码改动，本步骤跳过（没有可提交的内容）。

