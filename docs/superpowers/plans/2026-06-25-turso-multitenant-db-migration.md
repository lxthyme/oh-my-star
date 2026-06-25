# Turso 多租户数据库迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把数据库从本地 `better-sqlite3` 文件迁移到 Turso（libSQL）远程数据库，schema 拆出 `user_id` 支持多租户隔离，`lib/db/*` 全部异步化，并提供一次性脚本把本地已有数据迁移过去。

**Architecture:** `repos` 表只保留全局共享的仓库元数据；新增 `user_repos` 表存"谁拥有/star 了哪个仓库"；`repo_user_data`/`tags`/`repo_tags` 加 `user_id` 隔离。驱动从 `drizzle-orm/better-sqlite3` 换成 `drizzle-orm/libsql`，schema 迁移用 `drizzle-kit` 生成的 SQL 文件管理（不再在 `client.ts` 里内联建表）。

**Tech Stack:** `@libsql/client`、`drizzle-orm/libsql`、`drizzle-kit`（`dialect: "turso"`）、`tsx`（跑一次性迁移脚本）。

## Global Constraints

- 依赖本计划前置：`docs/superpowers/plans/2026-06-25-github-oauth-login.md` 必须已完成并合并——本计划 Task 7（路由接入 `userId`）需要从 `auth()` session 里取 `session.userId`，这个字段由那份计划的 Task 3 产出。Task 1-6（schema/client/sync/repos/tags/user-data 的改写与测试）不依赖它，可以独立推进。
- 所有文字输出、注释、提交信息使用简体中文；代码标识符使用英文。
- 默认不写注释；只在隐藏约束处加一行说明。
- libSQL 是异步驱动：drizzle 的 `.get()`/`.all()`/`.run()` 仍然存在，但返回 `Promise`，需要 `await`——不是把这些方法去掉，是给调用处加 `await`（已通过 Drizzle 官方文档核实）。
- `drizzle-kit generate` 不需要真实数据库连接（只做 schema 与本地迁移历史的 diff）；`drizzle-kit migrate`/远程连接才需要真实 `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`。本计划 Task 1-7 的所有自动化测试用 `:memory:` 跑，**不需要**真实 Turso 账号；只有 Task 8（数据迁移脚本的实际执行）和最后的部署清单需要。

---

## Prerequisites（人工操作，非代码任务）

1. **创建 Turso 账号**：访问 https://turso.tech ，注册账号，安装 Turso CLI（`curl -sSfL https://get.tur.so/install.sh | bash`，或参考官网说明）。
2. **创建两个 database**：
   ```
   turso db create next-github-star-dev
   turso db create next-github-star-prod
   ```
3. **拿到连接信息**：
   ```
   turso db show next-github-star-dev --url
   turso db tokens create next-github-star-dev
   ```
   对 `next-github-star-prod` 重复一遍。
4. **写入 `.env.local`**（dev 库用于本地开发）：
   ```
   TURSO_DATABASE_URL=<next-github-star-dev 的 url>
   TURSO_AUTH_TOKEN=<next-github-star-dev 的 token>
   ```
5. **在 Vercel 项目设置里配置生产环境变量**（指向 `next-github-star-prod`）：`TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`。这一步等到最后部署时再做。

Task 1-7 的单元测试全部用 `:memory:`，不读取上面这些变量；只有你想跑 `npm run dev` 连真实 dev 库、或执行 Task 8 的数据迁移脚本时才需要这些变量已配置。

---

### Task 1: 安装依赖、Drizzle Kit 配置

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`

**Interfaces:**
- Produces: `drizzle.config.ts`（供 `npx drizzle-kit generate`/`migrate` 使用），npm scripts `db:generate`/`db:migrate`/`db:migrate-legacy`。

- [x] **Step 1: 安装依赖**

Run: `npm install @libsql/client && npm install -D drizzle-kit tsx`

Expected: `package.json` 的 `dependencies` 新增 `@libsql/client`，`devDependencies` 新增 `drizzle-kit`、`tsx`。

- [x] **Step 2: 创建 Drizzle Kit 配置**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
```

- [x] **Step 3: 新增 npm scripts**

Modify `package.json` 的 `scripts` 字段，在 `"format:check"` 之后加入：

```json
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:migrate-legacy": "tsx scripts/migrate-legacy-data.ts",
```

- [x] **Step 4: 验证 CLI 可以读取配置（不需要真实连接）**

Run: `npx drizzle-kit generate --help`
Expected: 打印 `generate` 命令的帮助信息，无报错（证明 `drizzle.config.ts` 本身没有语法/导入错误）。

- [x] **Step 5: 提交**

```bash
git add package.json package-lock.json drizzle.config.ts
git commit -m "$(cat <<'EOF'
chore: 接入 Turso/libSQL 依赖与 drizzle-kit 配置

EOF
)"
```

---

### Task 2: 多租户 schema + libSQL 驱动 + 测试基建

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/client.ts`
- Create: `lib/db/test-helpers.ts`
- Modify: `lib/db/client.test.ts`
- Create (generated): `drizzle/*.sql`、`drizzle/meta/*`

**Interfaces:**
- Produces: `repos`、`userRepos`、`repoUserData`、`tags`、`repoTags`（schema.ts 导出的表对象，后续所有任务依赖）；`createDb(url, authToken?): AppDatabase`；`createTestDb(): Promise<AppDatabase>`（test-helpers.ts，后续 Task 3-6 的测试文件依赖）。

> 这个任务把 schema 改写、驱动切换、测试基建合并成一个任务而不拆开——三者改完之前项目处于不可编译的中间状态（`client.ts` 还在用旧驱动配旧 schema 形状），拆成多个"任务"会留下无法独立通过测试的提交，违反"每个任务结束都是可测试的交付物"的要求。

- [ ] **Step 1: 写新的 `client.test.ts`（先写测试，此时它会因为找不到新表/新模块而失败）**

Modify `lib/db/client.test.ts`（整个文件替换为）：

```ts
import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import { repos, userRepos, repoUserData, tags, repoTags } from "./schema"

describe("createTestDb", () => {
  it("creates all five tables and allows inserting into each", async () => {
    const db = await createTestDb()

    await db
      .insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
      })
      .run()
    await db
      .insert(userRepos)
      .values({ userId: 100, repoId: 1, isOwned: 1 })
      .run()
    await db
      .insert(repoUserData)
      .values({ userId: 100, repoId: 1, isFavorite: 1 })
      .run()
    await db
      .insert(tags)
      .values({
        userId: 100,
        name: "favorite-tools",
        createdAt: "2026-01-01T00:00:00Z",
      })
      .run()
    const tag = (await db.select().from(tags).get())!
    await db
      .insert(repoTags)
      .values({ userId: 100, repoId: 1, tagId: tag.id })
      .run()

    expect(await db.select().from(repos).all()).toHaveLength(1)
    expect(await db.select().from(userRepos).all()).toHaveLength(1)
    expect(await db.select().from(repoUserData).all()).toHaveLength(1)
    expect(await db.select().from(repoTags).all()).toHaveLength(1)
  })

  it("returns independent state for separate in-memory instances", async () => {
    const dbA = await createTestDb()
    const dbB = await createTestDb()

    await dbA
      .insert(repos)
      .values({
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/Hello-World",
      })
      .run()

    expect(await dbA.select().from(repos).all()).toHaveLength(1)
    expect(await dbB.select().from(repos).all()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/db/client.test.ts`
Expected: FAIL（`./test-helpers` 模块不存在，且 `userRepos`/`repoTags` 还不是新形状）。

- [ ] **Step 3: 改写 `lib/db/schema.ts`**

Modify `lib/db/schema.ts`（整个文件替换为）：

```ts
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  unique,
} from "drizzle-orm/sqlite-core"

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
  mirrorUrl: text("mirror_url"),
  pushedAt: text("pushed_at"),
  updatedAt: text("updated_at"),
  createdAt: text("created_at"),
})

export const userRepos = sqliteTable(
  "user_repos",
  {
    userId: integer("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    isOwned: integer("is_owned").notNull().default(0),
    isStarred: integer("is_starred").notNull().default(0),
    starredAt: text("starred_at"),
    syncedAt: text("synced_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoId] })],
)

export const repoUserData = sqliteTable(
  "repo_user_data",
  {
    userId: integer("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    isFavorite: integer("is_favorite").notNull().default(0),
    note: text("note"),
    noteUpdatedAt: text("note_updated_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoId] })],
)

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [unique().on(table.userId, table.name)],
)

export const repoTags = sqliteTable(
  "repo_tags",
  {
    userId: integer("user_id").notNull(),
    repoId: integer("repo_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.repoId, table.tagId] }),
  ],
)
```

- [ ] **Step 4: 改写 `lib/db/client.ts`（换成 libSQL 驱动，去掉内联建表/迁移逻辑）**

Modify `lib/db/client.ts`（整个文件替换为）：

```ts
import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import * as schema from "./schema"

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

export function createDb(url: string, authToken?: string): AppDatabase {
  const client = createClient({ url, authToken })
  return drizzle(client, { schema })
}

declare global {
  var __appDb: AppDatabase | undefined
}

const url = process.env.TURSO_DATABASE_URL ?? ":memory:"
const authToken = process.env.TURSO_AUTH_TOKEN

export const db = globalThis.__appDb ?? createDb(url, authToken)

if (process.env.NODE_ENV !== "production") {
  globalThis.__appDb = db
}
```

- [ ] **Step 5: 生成首个 migration（此时 schema.ts 已是最终多租户形状，生成的 SQL 直接就是目标结构，不需要中间版本）**

Run: `npm run db:generate`
Expected: 在 `./drizzle` 目录下生成 `0000_xxx.sql`（建表语句）与 `meta/_journal.json`、`meta/0000_snapshot.json`。打开生成的 `.sql` 文件确认包含 `CREATE TABLE` `repos`、`user_repos`、`repo_user_data`、`tags`、`repo_tags` 五张表。

- [ ] **Step 6: 创建测试基建 `test-helpers.ts`（对生成的 migration 应用到 `:memory:` 实例）**

Create `lib/db/test-helpers.ts`:

```ts
import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import * as schema from "./schema"
import type { AppDatabase } from "./client"

export async function createTestDb(): Promise<AppDatabase> {
  const client = createClient({ url: ":memory:" })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "./drizzle" })
  return db
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run lib/db/client.test.ts`
Expected: 2 个测试全部 PASS。

- [ ] **Step 8: 类型检查**

Run: `npx tsc --noEmit`
Expected: 报错——`lib/db/sync.ts`、`lib/db/repos.ts`、`lib/db/tags.ts`、`lib/db/user-data.ts` 及其测试文件会因为引用旧的 `repos.isOwned` 等已删除字段而编译失败。**这是预期的**，Task 3-6 会逐一修复；本任务先确认 `lib/db/schema.ts`、`lib/db/client.ts`、`lib/db/test-helpers.ts`、`lib/db/client.test.ts` 这四个文件本身没有类型错误：

Run: `npx tsc --noEmit 2>&1 | grep -E "^(lib/db/schema|lib/db/client|lib/db/test-helpers)"`
Expected: 无输出。

- [ ] **Step 9: 提交（包含生成的 `drizzle/` 迁移文件，必须随代码一起入库）**

```bash
git add lib/db/schema.ts lib/db/client.ts lib/db/test-helpers.ts lib/db/client.test.ts drizzle/
git commit -m "$(cat <<'EOF'
feat: schema 拆分多租户表结构，client 切换为 libSQL 驱动

EOF
)"
```

---

### Task 3: `lib/db/sync.ts` 异步化 + 多租户改写

**Files:**
- Modify: `lib/db/sync.ts`
- Modify: `lib/db/sync.test.ts`

**Interfaces:**
- Consumes: `repos`、`userRepos` from `./schema`（Task 2 produced）。
- Produces: `syncRepos(db: AppDatabase, userId: number, input: SyncInput): Promise<SyncResult>`；`getLastSyncedAt(db: AppDatabase, userId: number): Promise<string | null>`。后续 Task 7（路由接入）依赖这两个新签名。

- [ ] **Step 1: 改写测试**

Modify `lib/db/sync.test.ts`（整个文件替换为）：

```ts
import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb } from "./test-helpers"
import { repos, userRepos, repoUserData } from "./schema"
import { syncRepos, getLastSyncedAt } from "./sync"
import type { GitHubRepoData } from "../github"

const TEST_USER_ID = 1001

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
    mirrorUrl: null,
    pushedAt: null,
    updatedAt: null,
    createdAt: null,
    ...overrides,
  }
}

describe("syncRepos", () => {
  it("marks owned repos with is_owned = 1 and is_starred = 0", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo()], starred: [] })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isOwned).toBe(1)
    expect(row!.isStarred).toBe(0)
  })

  it("marks a repo as both owned and starred when it appears in both lists", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [makeRepo()],
      starred: [{ repo: makeRepo(), starredAt: "2026-01-01T00:00:00Z" }],
    })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isOwned).toBe(1)
    expect(row!.isStarred).toBe(1)
    expect(row!.starredAt).toBe("2026-01-01T00:00:00Z")
  })

  it("resets is_owned/is_starred for repos missing from a later sync, without touching repo_user_data", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [makeRepo({ id: 1 })],
      starred: [],
    })
    await db
      .insert(repoUserData)
      .values({ userId: TEST_USER_ID, repoId: 1, isFavorite: 1, note: "记得看看" })
      .run()

    await syncRepos(db, TEST_USER_ID, { owned: [], starred: [] })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isOwned).toBe(0)
    expect(row!.isStarred).toBe(0)

    const userData = await db
      .select()
      .from(repoUserData)
      .where(
        and(eq(repoUserData.userId, TEST_USER_ID), eq(repoUserData.repoId, 1)),
      )
      .get()
    expect(userData!.isFavorite).toBe(1)
    expect(userData!.note).toBe("记得看看")
  })

  it("re-flags a repo back to 1 if it reappears in a subsequent sync", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [],
      starred: [
        { repo: makeRepo({ id: 1 }), starredAt: "2026-01-01T00:00:00Z" },
      ],
    })
    await syncRepos(db, TEST_USER_ID, { owned: [], starred: [] })
    await syncRepos(db, TEST_USER_ID, {
      owned: [],
      starred: [
        { repo: makeRepo({ id: 1 }), starredAt: "2026-02-01T00:00:00Z" },
      ],
    })

    const row = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    expect(row!.isStarred).toBe(1)
    expect(row!.starredAt).toBe("2026-02-01T00:00:00Z")
  })

  it("stores mirrorUrl from GitHubRepoData", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, {
      owned: [
        makeRepo({
          mirrorUrl: "https://git.example.com/octocat/Hello-World.git",
        }),
      ],
      starred: [],
    })

    const row = await db.select().from(repos).where(eq(repos.id, 1)).get()
    expect(row!.mirrorUrl).toBe(
      "https://git.example.com/octocat/Hello-World.git",
    )
  })

  it("returns counts matching the input lists", async () => {
    const db = await createTestDb()
    const result = await syncRepos(db, TEST_USER_ID, {
      owned: [
        makeRepo({ id: 1 }),
        makeRepo({
          id: 2,
          fullName: "octocat/Spoon-Knife",
          name: "Spoon-Knife",
        }),
      ],
      starred: [
        {
          repo: makeRepo({ id: 3, fullName: "octocat/Other", name: "Other" }),
          starredAt: "2026-01-01T00:00:00Z",
        },
      ],
    })

    expect(result).toEqual({ ownedCount: 2, starredCount: 1 })
  })

  it("upserts shared repo metadata once even when synced by a different user", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo({ id: 1 })], starred: [] })
    await syncRepos(db, 2002, {
      owned: [],
      starred: [{ repo: makeRepo({ id: 1 }), starredAt: "2026-03-01T00:00:00Z" }],
    })

    expect(await db.select().from(repos).all()).toHaveLength(1)
    const mine = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .get()
    const theirs = await db
      .select()
      .from(userRepos)
      .where(and(eq(userRepos.userId, 2002), eq(userRepos.repoId, 1)))
      .get()
    expect(mine!.isOwned).toBe(1)
    expect(theirs!.isStarred).toBe(1)
  })
})

describe("getLastSyncedAt", () => {
  it("returns null when there are no repos", async () => {
    const db = await createTestDb()
    expect(await getLastSyncedAt(db, TEST_USER_ID)).toBeNull()
  })

  it("returns the most recent synced_at across all repos for that user", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo({ id: 1 })], starred: [] })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-01-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .run()

    await syncRepos(db, TEST_USER_ID, {
      owned: [
        makeRepo({
          id: 2,
          fullName: "octocat/Spoon-Knife",
          name: "Spoon-Knife",
        }),
      ],
      starred: [],
    })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-03-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 2)))
      .run()

    expect(await getLastSyncedAt(db, TEST_USER_ID)).toBe(
      "2026-03-01T00:00:00.000Z",
    )
  })

  it("only considers the given user's synced_at, not other users'", async () => {
    const db = await createTestDb()
    await syncRepos(db, TEST_USER_ID, { owned: [makeRepo({ id: 1 })], starred: [] })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-01-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, TEST_USER_ID), eq(userRepos.repoId, 1)))
      .run()

    await syncRepos(db, 2002, { owned: [makeRepo({ id: 1 })], starred: [] })
    await db
      .update(userRepos)
      .set({ syncedAt: "2026-05-01T00:00:00.000Z" })
      .where(and(eq(userRepos.userId, 2002), eq(userRepos.repoId, 1)))
      .run()

    expect(await getLastSyncedAt(db, TEST_USER_ID)).toBe(
      "2026-01-01T00:00:00.000Z",
    )
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/db/sync.test.ts`
Expected: FAIL（`syncRepos`/`getLastSyncedAt` 还是旧的两参数同步签名）。

- [ ] **Step 3: 改写实现**

Modify `lib/db/sync.ts`（整个文件替换为）：

```ts
import { eq, sql } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos, userRepos } from "./schema"
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

export async function syncRepos(
  db: AppDatabase,
  userId: number,
  input: SyncInput,
): Promise<SyncResult> {
  const merged = new Map<number, MergedEntry>()

  for (const repo of input.owned) {
    merged.set(repo.id, {
      repo,
      isOwned: true,
      isStarred: false,
      starredAt: null,
    })
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

  await db.transaction(async (tx) => {
    await tx
      .update(userRepos)
      .set({ isOwned: 0, isStarred: 0, starredAt: null })
      .where(eq(userRepos.userId, userId))
      .run()

    for (const entry of merged.values()) {
      const repoValues = {
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
        mirrorUrl: entry.repo.mirrorUrl,
        pushedAt: entry.repo.pushedAt,
        updatedAt: entry.repo.updatedAt,
        createdAt: entry.repo.createdAt,
      }

      await tx
        .insert(repos)
        .values(repoValues)
        .onConflictDoUpdate({ target: repos.id, set: repoValues })
        .run()

      const userRepoValues = {
        userId,
        repoId: entry.repo.id,
        isOwned: entry.isOwned ? 1 : 0,
        isStarred: entry.isStarred ? 1 : 0,
        starredAt: entry.starredAt,
        syncedAt: now,
      }

      await tx
        .insert(userRepos)
        .values(userRepoValues)
        .onConflictDoUpdate({
          target: [userRepos.userId, userRepos.repoId],
          set: userRepoValues,
        })
        .run()
    }
  })

  return { ownedCount: input.owned.length, starredCount: input.starred.length }
}

export async function getLastSyncedAt(
  db: AppDatabase,
  userId: number,
): Promise<string | null> {
  const row = await db
    .select({ lastSyncedAt: sql<string | null>`MAX(${userRepos.syncedAt})` })
    .from(userRepos)
    .where(eq(userRepos.userId, userId))
    .get()
  return row!.lastSyncedAt
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/db/sync.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/db/sync.ts lib/db/sync.test.ts
git commit -m "$(cat <<'EOF'
feat: sync 异步化并按 user_id 拆分仓库关系数据

EOF
)"
```

---

### Task 4: `lib/db/repos.ts` 异步化 + JOIN `user_repos`

**Files:**
- Modify: `lib/db/repos.ts`
- Modify: `lib/db/repos.test.ts`

**Interfaces:**
- Consumes: `repos`、`userRepos`、`repoUserData`、`repoTags`、`tags` from `./schema`。
- Produces: `listRepos(db, userId, params): Promise<ListReposResult>`；`listDistinctLanguages(db, userId, source): Promise<string[]>`；`countReposBySource(db, userId): Promise<RepoSourceCounts>`；`setStarred(db, userId, repoId, isStarred): Promise<void>`。Task 7 依赖这四个新签名。

- [ ] **Step 1: 改写测试**

Modify `lib/db/repos.test.ts`（整个文件替换为）：

```ts
import { describe, expect, it, beforeEach } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos, userRepos, repoUserData, tags, repoTags } from "./schema"
import {
  listRepos,
  listDistinctLanguages,
  setStarred,
  countReposBySource,
} from "./repos"

const TEST_USER_ID = 1001

interface RepoOverrides {
  id?: number
  name?: string
  fullName?: string
  language?: string | null
  fork?: number
  archived?: number
  isTemplate?: number
  mirrorUrl?: string | null
  isOwned?: number
  isStarred?: number
  starredAt?: string | null
  stargazersCount?: number
  pushedAt?: string | null
}

async function insertRepo(db: AppDatabase, overrides: RepoOverrides = {}) {
  const repo = {
    id: 1,
    name: "Hello-World",
    fullName: "octocat/Hello-World",
    language: "TypeScript" as string | null,
    fork: 0,
    archived: 0,
    isTemplate: 0,
    mirrorUrl: null as string | null,
    isOwned: 1,
    isStarred: 0,
    starredAt: null as string | null,
    stargazersCount: 0,
    pushedAt: "2026-01-01T00:00:00Z" as string | null,
    ...overrides,
  }

  await db
    .insert(repos)
    .values({
      id: repo.id,
      fullName: repo.fullName,
      name: repo.name,
      ownerLogin: "octocat",
      htmlUrl: `https://github.com/${repo.fullName}`,
      language: repo.language,
      fork: repo.fork,
      archived: repo.archived,
      isTemplate: repo.isTemplate,
      mirrorUrl: repo.mirrorUrl,
      stargazersCount: repo.stargazersCount,
      pushedAt: repo.pushedAt,
    })
    .run()

  await db
    .insert(userRepos)
    .values({
      userId: TEST_USER_ID,
      repoId: repo.id,
      isOwned: repo.isOwned,
      isStarred: repo.isStarred,
      starredAt: repo.starredAt,
    })
    .run()
}

describe("listRepos", () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = await createTestDb()
  })

  it("filters by source (owned vs starred)", async () => {
    await insertRepo(db, { id: 1, isOwned: 1, isStarred: 0 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      isOwned: 0,
      isStarred: 1,
    })

    const owned = await listRepos(db, TEST_USER_ID, { source: "owned" })
    const starred = await listRepos(db, TEST_USER_ID, { source: "starred" })
    expect(owned.items.map((r) => r.id)).toEqual([1])
    expect(starred.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by type=forks", async () => {
    await insertRepo(db, { id: 1, fork: 0 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
      fork: 1,
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      type: "forks",
    })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("excludes forks/archived/templates from type=sources", async () => {
    await insertRepo(db, { id: 1, fork: 0, archived: 0, isTemplate: 0 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Fork",
      name: "Fork",
      fork: 1,
    })
    await insertRepo(db, {
      id: 3,
      fullName: "octocat/Old",
      name: "Old",
      archived: 1,
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      type: "sources",
    })
    expect(result.items.map((r) => r.id)).toEqual([1])
  })

  it("filters by type=mirrors", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Mirror",
      name: "Mirror",
      mirrorUrl: "https://git.example.com/x.git",
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      type: "mirrors",
    })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("ignores language filter when set to 'all'", async () => {
    await insertRepo(db, { id: 1, language: "TypeScript" })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Py",
      name: "Py",
      language: "Python",
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      language: "all",
    })
    expect(result.items).toHaveLength(2)
  })

  it("filters by a specific language", async () => {
    await insertRepo(db, { id: 1, language: "TypeScript" })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Py",
      name: "Py",
      language: "Python",
    })

    const result = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      language: "Python",
    })
    expect(result.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by favorite status using repo_user_data", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
    })
    await db
      .insert(repoUserData)
      .values({ userId: TEST_USER_ID, repoId: 1, isFavorite: 1 })
      .run()

    const favorite = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      favorite: "favorite",
    })
    const notFavorite = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      favorite: "not_favorite",
    })
    expect(favorite.items.map((r) => r.id)).toEqual([1])
    expect(notFavorite.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by note status using repo_user_data", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
    })
    await db
      .insert(repoUserData)
      .values({ userId: TEST_USER_ID, repoId: 1, note: "记得看看" })
      .run()

    const noted = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      note: "noted",
    })
    const notNoted = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      note: "not_noted",
    })
    expect(noted.items.map((r) => r.id)).toEqual([1])
    expect(notNoted.items.map((r) => r.id)).toEqual([2])
  })

  it("filters by tagId and by 'untagged'", async () => {
    await insertRepo(db, { id: 1 })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/Spoon-Knife",
      name: "Spoon-Knife",
    })
    const [tag] = await db
      .insert(tags)
      .values({
        userId: TEST_USER_ID,
        name: "cli",
        createdAt: "2026-01-01T00:00:00Z",
      })
      .returning({ id: tags.id })
    await db
      .insert(repoTags)
      .values({ userId: TEST_USER_ID, repoId: 1, tagId: tag.id })
      .run()

    const tagged = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      tagId: tag.id,
    })
    const untagged = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      tagId: "untagged",
    })
    expect(tagged.items.map((r) => r.id)).toEqual([1])
    expect(untagged.items.map((r) => r.id)).toEqual([2])
  })

  it("attaches resolved tags to each item", async () => {
    await insertRepo(db, { id: 1 })
    const [tag] = await db
      .insert(tags)
      .values({
        userId: TEST_USER_ID,
        name: "cli",
        createdAt: "2026-01-01T00:00:00Z",
      })
      .returning({ id: tags.id })
    await db
      .insert(repoTags)
      .values({ userId: TEST_USER_ID, repoId: 1, tagId: tag.id })
      .run()

    const result = await listRepos(db, TEST_USER_ID, { source: "owned" })
    expect(result.items[0].tags).toEqual([{ id: tag.id, name: "cli" }])
  })

  it("sorts by name ascending and by stars descending", async () => {
    await insertRepo(db, {
      id: 1,
      name: "Zeta",
      fullName: "octocat/Zeta",
      stargazersCount: 1,
    })
    await insertRepo(db, {
      id: 2,
      name: "Alpha",
      fullName: "octocat/Alpha",
      stargazersCount: 9,
    })

    const byName = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      sort: "name",
    })
    const byStars = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      sort: "stars",
    })
    expect(byName.items.map((r) => r.name)).toEqual(["Alpha", "Zeta"])
    expect(byStars.items.map((r) => r.id)).toEqual([2, 1])
  })

  it("paginates with the given page size", async () => {
    for (let i = 1; i <= 5; i++) {
      await insertRepo(db, {
        id: i,
        name: `Repo${i}`,
        fullName: `octocat/Repo${i}`,
      })
    }

    const page1 = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      perPage: 2,
      page: 1,
    })
    const page2 = await listRepos(db, TEST_USER_ID, {
      source: "owned",
      perPage: 2,
      page: 2,
    })

    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(2)
    expect(page1.total).toBe(5)
  })

  it("only returns repos belonging to the given user", async () => {
    await insertRepo(db, { id: 1 })
    const otherUserId = 2002
    await db
      .insert(userRepos)
      .values({ userId: otherUserId, repoId: 1, isOwned: 1 })
      .run()

    const result = await listRepos(db, otherUserId, { source: "owned" })
    expect(result.items.map((r) => r.id)).toEqual([1])

    const stranger = await listRepos(db, 9999, { source: "owned" })
    expect(stranger.items).toEqual([])
  })
})

describe("listDistinctLanguages", () => {
  it("returns sorted unique languages for the given source", async () => {
    const db = await createTestDb()
    await insertRepo(db, {
      id: 1,
      fullName: "octocat/A",
      name: "A",
      language: "TypeScript",
    })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/B",
      name: "B",
      language: "Python",
    })
    await insertRepo(db, {
      id: 3,
      fullName: "octocat/C",
      name: "C",
      language: "TypeScript",
    })
    await insertRepo(db, {
      id: 4,
      fullName: "octocat/D",
      name: "D",
      language: "Go",
      isOwned: 0,
      isStarred: 1,
    })

    expect(await listDistinctLanguages(db, TEST_USER_ID, "owned")).toEqual([
      "Python",
      "TypeScript",
    ])
  })
})

describe("countReposBySource", () => {
  it("counts owned and starred repos independently of filters", async () => {
    const db = await createTestDb()
    await insertRepo(db, {
      id: 1,
      fullName: "octocat/A",
      name: "A",
      isOwned: 1,
      isStarred: 0,
    })
    await insertRepo(db, {
      id: 2,
      fullName: "octocat/B",
      name: "B",
      isOwned: 1,
      isStarred: 1,
    })
    await insertRepo(db, {
      id: 3,
      fullName: "octocat/C",
      name: "C",
      isOwned: 0,
      isStarred: 1,
    })

    expect(await countReposBySource(db, TEST_USER_ID)).toEqual({
      owned: 2,
      starred: 2,
    })
  })
})

describe("setStarred", () => {
  it("updates is_starred and starred_at", async () => {
    const db = await createTestDb()
    await insertRepo(db, { id: 1, fullName: "octocat/A", name: "A", isOwned: 1 })

    await setStarred(db, TEST_USER_ID, 1, true)
    let result = await listRepos(db, TEST_USER_ID, { source: "owned" })
    expect(result.items[0].isStarred).toBe(true)

    await setStarred(db, TEST_USER_ID, 1, false)
    result = await listRepos(db, TEST_USER_ID, { source: "owned" })
    expect(result.items[0].isStarred).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/db/repos.test.ts`
Expected: FAIL（`listRepos` 等函数还是旧的两参数同步签名，且 `userRepos` 未被使用）。

- [ ] **Step 3: 改写实现**

Modify `lib/db/repos.ts`（整个文件替换为）：

```ts
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repos, userRepos, repoUserData, repoTags, tags } from "./schema"

export type RepoSource = "owned" | "starred"
export type RepoTypeFilter =
  | "all"
  | "sources"
  | "forks"
  | "archived"
  | "mirrors"
  | "templates"
export type RepoSort = "updated" | "name" | "stars" | "starred_at"
export type TriStateFilter = "all" | "favorite" | "not_favorite"
export type NoteFilterValue = "all" | "noted" | "not_noted"

export interface ListReposParams {
  source: RepoSource
  search?: string
  searchDescription?: boolean
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

function buildWhere(userId: number, params: ListReposParams): SQL | undefined {
  const conditions: SQL[] = [eq(userRepos.userId, userId)]

  conditions.push(
    params.source === "owned"
      ? eq(userRepos.isOwned, 1)
      : eq(userRepos.isStarred, 1),
  )

  if (params.search) {
    const term = `%${params.search}%`
    conditions.push(
      (params.searchDescription ?? true)
        ? sql`(${repos.name} LIKE ${term} OR ${repos.description} LIKE ${term})`
        : sql`${repos.name} LIKE ${term}`,
    )
  }

  if (params.type === "sources") {
    conditions.push(
      eq(repos.fork, 0),
      eq(repos.archived, 0),
      eq(repos.isTemplate, 0),
    )
  } else if (params.type === "forks") {
    conditions.push(eq(repos.fork, 1))
  } else if (params.type === "archived") {
    conditions.push(eq(repos.archived, 1))
  } else if (params.type === "mirrors") {
    conditions.push(sql`${repos.mirrorUrl} IS NOT NULL`)
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
    conditions.push(
      sql`(${repoUserData.note} IS NOT NULL AND ${repoUserData.note} != '')`,
    )
  } else if (params.note === "not_noted") {
    conditions.push(
      sql`(${repoUserData.note} IS NULL OR ${repoUserData.note} = '')`,
    )
  }

  if (params.tagId === "untagged") {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id} AND ${repoTags.userId} = ${userId})`,
    )
  } else if (typeof params.tagId === "number") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${repoTags} WHERE ${repoTags.repoId} = ${repos.id} AND ${repoTags.tagId} = ${params.tagId} AND ${repoTags.userId} = ${userId})`,
    )
  }

  return and(...conditions)
}

export async function listRepos(
  db: AppDatabase,
  userId: number,
  params: ListReposParams,
): Promise<ListReposResult> {
  const page = params.page && params.page > 0 ? params.page : 1
  const perPage =
    params.perPage && params.perPage > 0 ? params.perPage : DEFAULT_PER_PAGE
  const where = buildWhere(userId, params)

  const sortColumnMap = {
    updated: repos.pushedAt,
    name: repos.name,
    stars: repos.stargazersCount,
    starred_at: userRepos.starredAt,
  } as const
  const sortColumn = sortColumnMap[params.sort ?? "updated"]
  const orderFn = params.sort === "name" ? asc : desc

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(repos)
    .innerJoin(userRepos, eq(userRepos.repoId, repos.id))
    .leftJoin(
      repoUserData,
      and(
        eq(repoUserData.repoId, repos.id),
        eq(repoUserData.userId, userId),
      ),
    )
    .where(where)
    .get()
  const total = totalRow!.count

  const rows = await db
    .select({
      repo: repos,
      userRepo: userRepos,
      isFavorite: repoUserData.isFavorite,
      note: repoUserData.note,
    })
    .from(repos)
    .innerJoin(userRepos, eq(userRepos.repoId, repos.id))
    .leftJoin(
      repoUserData,
      and(
        eq(repoUserData.repoId, repos.id),
        eq(repoUserData.userId, userId),
      ),
    )
    .where(where)
    .orderBy(orderFn(sortColumn))
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all()

  const repoIds = rows.map((row) => row.repo.id)
  const tagRows = repoIds.length
    ? await db
        .select({ repoId: repoTags.repoId, tagId: tags.id, tagName: tags.name })
        .from(repoTags)
        .innerJoin(tags, eq(tags.id, repoTags.tagId))
        .where(
          and(inArray(repoTags.repoId, repoIds), eq(repoTags.userId, userId)),
        )
        .all()
    : []

  const tagsByRepoId = new Map<number, { id: number; name: string }[]>()
  for (const row of tagRows) {
    const list = tagsByRepoId.get(row.repoId) ?? []
    list.push({ id: row.tagId, name: row.tagName })
    tagsByRepoId.set(row.repoId, list)
  }

  const items: RepoListItem[] = rows.map(
    ({ repo, userRepo, isFavorite, note }) => ({
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
      isOwned: userRepo.isOwned === 1,
      isStarred: userRepo.isStarred === 1,
      starredAt: userRepo.starredAt,
      isFavorite: isFavorite === 1,
      note,
      tags: tagsByRepoId.get(repo.id) ?? [],
    }),
  )

  return { items, total, page, perPage }
}

export async function listDistinctLanguages(
  db: AppDatabase,
  userId: number,
  source: RepoSource,
): Promise<string[]> {
  const sourceCondition =
    source === "owned" ? eq(userRepos.isOwned, 1) : eq(userRepos.isStarred, 1)
  const rows = await db
    .select({ language: repos.language })
    .from(repos)
    .innerJoin(userRepos, eq(userRepos.repoId, repos.id))
    .where(
      and(
        eq(userRepos.userId, userId),
        sourceCondition,
        sql`${repos.language} IS NOT NULL`,
      ),
    )
    .all()
  return [...new Set(rows.map((row) => row.language as string))].sort()
}

export interface RepoSourceCounts {
  owned: number
  starred: number
}

export async function countReposBySource(
  db: AppDatabase,
  userId: number,
): Promise<RepoSourceCounts> {
  const owned = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRepos)
    .where(and(eq(userRepos.userId, userId), eq(userRepos.isOwned, 1)))
    .get()
  const starred = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRepos)
    .where(and(eq(userRepos.userId, userId), eq(userRepos.isStarred, 1)))
    .get()
  return { owned: owned!.count, starred: starred!.count }
}

export async function setStarred(
  db: AppDatabase,
  userId: number,
  repoId: number,
  isStarred: boolean,
): Promise<void> {
  await db
    .update(userRepos)
    .set({
      isStarred: isStarred ? 1 : 0,
      starredAt: isStarred ? new Date().toISOString() : null,
    })
    .where(and(eq(userRepos.userId, userId), eq(userRepos.repoId, repoId)))
    .run()
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/db/repos.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/db/repos.ts lib/db/repos.test.ts
git commit -m "$(cat <<'EOF'
feat: repos 查询异步化并 JOIN user_repos 按用户隔离

EOF
)"
```

---

### Task 5: `lib/db/tags.ts` 异步化 + `user_id` 隔离

**Files:**
- Modify: `lib/db/tags.ts`
- Modify: `lib/db/tags.test.ts`

**Interfaces:**
- Produces: `listTags(db, userId): Promise<TagOption[]>`；`createTag(db, userId, name): Promise<TagOption>`；`getRepoTags(db, userId, repoId): Promise<TagOption[]>`；`setRepoTags(db, userId, repoId, tagNames): Promise<TagOption[]>`。Task 7 依赖这四个新签名。

- [ ] **Step 1: 改写测试**

Modify `lib/db/tags.test.ts`（整个文件替换为）：

```ts
import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos } from "./schema"
import { listTags, createTag, getRepoTags, setRepoTags } from "./tags"

const TEST_USER_ID = 1001

describe("createTag", () => {
  it("creates a new tag", async () => {
    const db = await createTestDb()
    const tag = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(tag.name).toBe("cli-tools")
    expect(await listTags(db, TEST_USER_ID)).toEqual([
      { id: tag.id, name: "cli-tools" },
    ])
  })

  it("is idempotent for an existing name", async () => {
    const db = await createTestDb()
    const first = await createTag(db, TEST_USER_ID, "cli-tools")
    const second = await createTag(db, TEST_USER_ID, "cli-tools")
    expect(second.id).toBe(first.id)
    expect(await listTags(db, TEST_USER_ID)).toHaveLength(1)
  })

  it("allows the same tag name for different users", async () => {
    const db = await createTestDb()
    const mine = await createTag(db, TEST_USER_ID, "cli-tools")
    const theirs = await createTag(db, 2002, "cli-tools")
    expect(theirs.id).not.toBe(mine.id)
  })
})

describe("listTags", () => {
  it("returns tags sorted by name", async () => {
    const db = await createTestDb()
    await createTag(db, TEST_USER_ID, "zebra")
    await createTag(db, TEST_USER_ID, "alpha")
    expect((await listTags(db, TEST_USER_ID)).map((t) => t.name)).toEqual([
      "alpha",
      "zebra",
    ])
  })
})

describe("setRepoTags / getRepoTags", () => {
  async function insertTestRepo(db: AppDatabase) {
    await db
      .insert(repos)
      .values({
        id: 1,
        fullName: "octocat/A",
        name: "A",
        ownerLogin: "octocat",
        htmlUrl: "https://github.com/octocat/A",
      })
      .run()
  }

  it("attaches tags to a repo, creating new ones as needed", async () => {
    const db = await createTestDb()
    await insertTestRepo(db)

    const result = await setRepoTags(db, TEST_USER_ID, 1, [
      "cli",
      "favorite-tools",
    ])
    expect(result.map((t) => t.name).sort()).toEqual([
      "cli",
      "favorite-tools",
    ])
    expect(
      (await getRepoTags(db, TEST_USER_ID, 1)).map((t) => t.name).sort(),
    ).toEqual(["cli", "favorite-tools"])
  })

  it("replaces the previous tag set rather than appending", async () => {
    const db = await createTestDb()
    await insertTestRepo(db)

    await setRepoTags(db, TEST_USER_ID, 1, ["cli", "old-tag"])
    await setRepoTags(db, TEST_USER_ID, 1, ["cli", "new-tag"])

    expect(
      (await getRepoTags(db, TEST_USER_ID, 1)).map((t) => t.name).sort(),
    ).toEqual(["cli", "new-tag"])
  })

  it("trims whitespace and drops empty/duplicate names", async () => {
    const db = await createTestDb()
    await insertTestRepo(db)

    const result = await setRepoTags(db, TEST_USER_ID, 1, [
      " cli ",
      "cli",
      "",
      "  ",
    ])
    expect(result.map((t) => t.name)).toEqual(["cli"])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/db/tags.test.ts`
Expected: FAIL（`createTag` 等函数还是旧的两参数同步签名）。

- [ ] **Step 3: 改写实现**

Modify `lib/db/tags.ts`（整个文件替换为）：

```ts
import { and, eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoTags, tags } from "./schema"

export interface TagOption {
  id: number
  name: string
}

export async function listTags(
  db: AppDatabase,
  userId: number,
): Promise<TagOption[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(tags.name)
    .all()
}

export async function createTag(
  db: AppDatabase,
  userId: number,
  name: string,
): Promise<TagOption> {
  const existing = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)))
    .get()
  if (existing) return existing

  const now = new Date().toISOString()
  const [inserted] = await db
    .insert(tags)
    .values({ userId, name, createdAt: now })
    .returning({ id: tags.id })
  return { id: inserted.id, name }
}

export async function getRepoTags(
  db: AppDatabase,
  userId: number,
  repoId: number,
): Promise<TagOption[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(repoTags)
    .innerJoin(tags, eq(tags.id, repoTags.tagId))
    .where(and(eq(repoTags.repoId, repoId), eq(repoTags.userId, userId)))
    .orderBy(tags.name)
    .all()
}

export async function setRepoTags(
  db: AppDatabase,
  userId: number,
  repoId: number,
  tagNames: string[],
): Promise<TagOption[]> {
  const uniqueNames = [
    ...new Set(tagNames.map((name) => name.trim()).filter(Boolean)),
  ]
  const resolved: TagOption[] = []
  for (const name of uniqueNames) {
    resolved.push(await createTag(db, userId, name))
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(repoTags)
      .where(and(eq(repoTags.repoId, repoId), eq(repoTags.userId, userId)))
      .run()
    for (const tag of resolved) {
      await tx.insert(repoTags).values({ userId, repoId, tagId: tag.id }).run()
    }
  })

  return resolved
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/db/tags.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/db/tags.ts lib/db/tags.test.ts
git commit -m "$(cat <<'EOF'
feat: tags 异步化并按 user_id 隔离命名空间

EOF
)"
```

---

### Task 6: `lib/db/user-data.ts` 异步化 + `user_id` 隔离

**Files:**
- Modify: `lib/db/user-data.ts`
- Modify: `lib/db/user-data.test.ts`

**Interfaces:**
- Produces: `setFavorite(db, userId, repoId, isFavorite): Promise<void>`；`setNote(db, userId, repoId, note): Promise<void>`；`getUserData(db, userId, repoId): Promise<{isFavorite, note}>`。Task 7 依赖这三个新签名。

- [ ] **Step 1: 改写测试**

Modify `lib/db/user-data.test.ts`（整个文件替换为）：

```ts
import { describe, expect, it } from "vitest"
import { createTestDb } from "./test-helpers"
import type { AppDatabase } from "./client"
import { repos } from "./schema"
import { setFavorite, setNote, getUserData } from "./user-data"

const TEST_USER_ID = 1001

const createTestRepo = async (db: AppDatabase, id: number) => {
  await db
    .insert(repos)
    .values({
      id,
      fullName: `test/repo${id}`,
      name: `repo${id}`,
      ownerLogin: "test",
      htmlUrl: "https://github.com/test/repo",
    })
    .run()
}

describe("setFavorite", () => {
  it("creates a repo_user_data row on first call", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setFavorite(db, TEST_USER_ID, 1, true)
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: true,
      note: null,
    })
  })

  it("toggles favorite without affecting an existing note", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setNote(db, TEST_USER_ID, 1, "记得看看")
    await setFavorite(db, TEST_USER_ID, 1, true)
    await setFavorite(db, TEST_USER_ID, 1, false)
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: false,
      note: "记得看看",
    })
  })
})

describe("setNote", () => {
  it("creates a repo_user_data row on first call", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setNote(db, TEST_USER_ID, 1, "值得学习的项目")
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: false,
      note: "值得学习的项目",
    })
  })

  it("overwrites the previous note without affecting favorite status", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setFavorite(db, TEST_USER_ID, 1, true)
    await setNote(db, TEST_USER_ID, 1, "first")
    await setNote(db, TEST_USER_ID, 1, "second")
    expect(await getUserData(db, TEST_USER_ID, 1)).toEqual({
      isFavorite: true,
      note: "second",
    })
  })
})

describe("getUserData", () => {
  it("returns defaults for a repo with no user data yet", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 999)
    expect(await getUserData(db, TEST_USER_ID, 999)).toEqual({
      isFavorite: false,
      note: null,
    })
  })

  it("keeps data isolated between different users", async () => {
    const db = await createTestDb()
    await createTestRepo(db, 1)
    await setFavorite(db, TEST_USER_ID, 1, true)
    expect(await getUserData(db, 2002, 1)).toEqual({
      isFavorite: false,
      note: null,
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/db/user-data.test.ts`
Expected: FAIL（`setFavorite` 等函数还是旧的两参数同步签名）。

- [ ] **Step 3: 改写实现**

Modify `lib/db/user-data.ts`（整个文件替换为）：

```ts
import { and, eq } from "drizzle-orm"
import type { AppDatabase } from "./client"
import { repoUserData } from "./schema"

export async function setFavorite(
  db: AppDatabase,
  userId: number,
  repoId: number,
  isFavorite: boolean,
): Promise<void> {
  await db
    .insert(repoUserData)
    .values({ userId, repoId, isFavorite: isFavorite ? 1 : 0 })
    .onConflictDoUpdate({
      target: [repoUserData.userId, repoUserData.repoId],
      set: { isFavorite: isFavorite ? 1 : 0 },
    })
    .run()
}

export async function setNote(
  db: AppDatabase,
  userId: number,
  repoId: number,
  note: string,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(repoUserData)
    .values({ userId, repoId, note, noteUpdatedAt: now })
    .onConflictDoUpdate({
      target: [repoUserData.userId, repoUserData.repoId],
      set: { note, noteUpdatedAt: now },
    })
    .run()
}

export async function getUserData(
  db: AppDatabase,
  userId: number,
  repoId: number,
): Promise<{ isFavorite: boolean; note: string | null }> {
  const row = await db
    .select()
    .from(repoUserData)
    .where(
      and(eq(repoUserData.userId, userId), eq(repoUserData.repoId, repoId)),
    )
    .get()
  return {
    isFavorite: row?.isFavorite === 1,
    note: row?.note ?? null,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/db/user-data.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 全量回归**

Run: `npm test && npx tsc --noEmit 2>&1 | grep -E "^lib/db"`
Expected: `npm test` 全部 PASS；第二条命令对 `lib/db/*` 路径无输出（Task 2-6 涉及的库文件已无类型错误；`app/api/**` 的类型错误属于 Task 7 范围，预期此时仍存在）。

- [ ] **Step 6: 提交**

```bash
git add lib/db/user-data.ts lib/db/user-data.test.ts
git commit -m "$(cat <<'EOF'
feat: user-data 异步化并按 user_id 隔离收藏与备注

EOF
)"
```

---

### Task 7: 所有 API 路由接入 `session.userId` + `await`

**Files:**
- Modify: `app/api/repos/route.ts`
- Modify: `app/api/repos/counts/route.ts`
- Modify: `app/api/repos/[id]/favorite/route.ts`
- Modify: `app/api/repos/[id]/note/route.ts`
- Modify: `app/api/repos/[id]/star/route.ts`
- Modify: `app/api/repos/[id]/tags/route.ts`
- Modify: `app/api/tags/route.ts`
- Modify: `app/api/sync/route.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth`（`docs/superpowers/plans/2026-06-25-github-oauth-login.md` 的 Task 1/3 produced）；Task 3-6 produced 的全部 `async` 签名。

> 这八个文件本身没有专属单元测试（现有项目约定：路由是薄封装，逻辑测试落在 `lib/db/*.test.ts` 里）。本任务用 `npx tsc --noEmit` + `npm run build` 作为编译期校验，外加登录后的手动 curl/浏览器验证作为行为校验——这与项目现有测试覆盖范围一致，没有新增"裸路由"测试是有意为之，不是遗漏。

- [ ] **Step 1: 改写 `app/api/repos/route.ts`**

Modify `app/api/repos/route.ts`（整个文件替换为）：

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import {
  listRepos,
  listDistinctLanguages,
  type ListReposParams,
} from "@/lib/db/repos"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const source = sp.get("source")
  if (source !== "owned" && source !== "starred") {
    return NextResponse.json(
      { error: "source 参数必须是 owned 或 starred" },
      { status: 400 },
    )
  }

  const tagIdParam = sp.get("tagId")
  const params: ListReposParams = {
    source,
    search: sp.get("search") ?? undefined,
    searchDescription: sp.get("searchDescription") !== "false",
    type: (sp.get("type") as ListReposParams["type"]) ?? "all",
    language: sp.get("language") ?? undefined,
    sort: (sp.get("sort") as ListReposParams["sort"]) ?? "updated",
    favorite: (sp.get("favorite") as ListReposParams["favorite"]) ?? "all",
    note: (sp.get("note") as ListReposParams["note"]) ?? "all",
    tagId:
      tagIdParam === "untagged"
        ? "untagged"
        : tagIdParam
          ? Number(tagIdParam)
          : undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    perPage: sp.get("perPage") ? Number(sp.get("perPage")) : undefined,
  }

  const result = await listRepos(db, session.userId, params)
  const languages = await listDistinctLanguages(db, session.userId, source)
  return NextResponse.json({ ...result, languages })
}
```

- [ ] **Step 2: 改写 `app/api/repos/counts/route.ts`**

Modify `app/api/repos/counts/route.ts`（整个文件替换为）：

```ts
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { countReposBySource } from "@/lib/db/repos"

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  return NextResponse.json(await countReposBySource(db, session.userId))
}
```

- [ ] **Step 3: 改写 `app/api/repos/[id]/favorite/route.ts`**

Modify `app/api/repos/[id]/favorite/route.ts`（整个文件替换为）：

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { setFavorite } from "@/lib/db/user-data"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.isFavorite !== "boolean") {
    return NextResponse.json(
      { error: "isFavorite 必须是 boolean" },
      { status: 400 },
    )
  }

  await setFavorite(db, session.userId, repoId, body.isFavorite)
  return NextResponse.json({ id: repoId, isFavorite: body.isFavorite })
}
```

- [ ] **Step 4: 改写 `app/api/repos/[id]/note/route.ts`**

Modify `app/api/repos/[id]/note/route.ts`（整个文件替换为）：

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { setNote } from "@/lib/db/user-data"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (typeof body.note !== "string") {
    return NextResponse.json({ error: "note 必须是字符串" }, { status: 400 })
  }

  await setNote(db, session.userId, repoId, body.note)
  return NextResponse.json({ id: repoId, note: body.note })
}
```

- [ ] **Step 5: 改写 `app/api/repos/[id]/star/route.ts`（同时补 Task 6 需要的 `userId` 与 `await`，叠加在上一份计划已经做的 session token 改动之上）**

Modify `app/api/repos/[id]/star/route.ts`（整个文件替换为）：

```ts
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { repos } from "@/lib/db/schema"
import { setStarred } from "@/lib/db/repos"
import { createGitHubClient, starRepo, unstarRepo } from "@/lib/github"

async function getOwnerAndName(
  repoId: number,
): Promise<{ owner: string; name: string } | null> {
  const row = await db
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
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const target = await getOwnerAndName(repoId)
  if (!target) {
    return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
  }

  try {
    await starRepo(
      createGitHubClient(session.accessToken),
      target.owner,
      target.name,
    )
    await setStarred(db, session.userId, repoId, true)
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
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const target = await getOwnerAndName(repoId)
  if (!target) {
    return NextResponse.json({ error: "仓库不存在" }, { status: 404 })
  }

  try {
    await unstarRepo(
      createGitHubClient(session.accessToken),
      target.owner,
      target.name,
    )
    await setStarred(db, session.userId, repoId, false)
    return NextResponse.json({ id: repoId, isStarred: false })
  } catch {
    return NextResponse.json(
      { error: "Unstar 失败，请稍后重试" },
      { status: 502 },
    )
  }
}
```

- [ ] **Step 6: 改写 `app/api/repos/[id]/tags/route.ts`**

Modify `app/api/repos/[id]/tags/route.ts`（整个文件替换为）：

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { getRepoTags, setRepoTags } from "@/lib/db/tags"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  return NextResponse.json({
    tags: await getRepoTags(db, session.userId, repoId),
  })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const { id } = await params
  const repoId = Number(id)
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "id 必须是数字" }, { status: 400 })
  }

  const body = await request.json()
  if (!Array.isArray(body.tagNames)) {
    return NextResponse.json(
      { error: "tagNames 必须是字符串数组" },
      { status: 400 },
    )
  }

  const tags = await setRepoTags(db, session.userId, repoId, body.tagNames)
  return NextResponse.json({ tags })
}
```

- [ ] **Step 7: 改写 `app/api/tags/route.ts`**

Modify `app/api/tags/route.ts`（整个文件替换为）：

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db/client"
import { listTags, createTag } from "@/lib/db/tags"

export async function GET() {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  return NextResponse.json({ tags: await listTags(db, session.userId) })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const body = await request.json()
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 不能为空" }, { status: 400 })
  }

  const tag = await createTag(db, session.userId, body.name.trim())
  return NextResponse.json(tag, { status: 201 })
}
```

- [ ] **Step 8: 改写 `app/api/sync/route.ts`（叠加上一份计划已做的 token 改动，补 `userId` 与 `await`）**

Modify `app/api/sync/route.ts`（整个文件替换为）：

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
  const session = await auth()
  if (!session?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  return NextResponse.json({
    lastSyncedAt: await getLastSyncedAt(db, session.userId),
  })
}

export async function POST() {
  const session = await auth()
  if (!session?.accessToken || !session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const client = createGitHubClient(session.accessToken)

  try {
    const [owned, starred] = await Promise.all([
      listOwnedRepos(client),
      listStarredRepos(client),
    ])
    const result = await syncRepos(db, session.userId, { owned, starred })
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

- [ ] **Step 9: 全量校验**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 三条命令全部成功（`npm run build` 成功证明所有路由文件类型与导入都正确闭环）。

- [ ] **Step 10: 手动验证（需要 Prerequisites 中的真实 Turso dev 库与上一份计划的真实 OAuth 凭据均已配置）**

Run: `npm run db:migrate`（把 Task 2 生成的迁移应用到 `.env.local` 里配置的 Turso dev 库），然后 `npm run dev`。
Expected: 登录后点击同步、收藏、加标签、写备注、star/unstar 均正常工作；重启 `npm run dev` 后数据仍在（证明确实落在远程 Turso，不是内存里的临时数据）。

- [ ] **Step 11: 提交**

```bash
git add app/api
git commit -m "$(cat <<'EOF'
feat: 全部 API 路由接入 session userId 并适配异步数据层

EOF
)"
```

---

### Task 8: 一次性数据迁移脚本

**Files:**
- Create: `scripts/migrate-legacy-data.ts`

**Interfaces:**
- Consumes: `repos`、`userRepos`、`repoUserData`、`tags`、`repoTags` from `@/lib/db/schema`；本地 `data/app.db`（旧 better-sqlite3 文件，原 4 表结构）。

> 这个脚本只为本项目"从单用户旧库迁移到 Turso 多租户新库"跑一次，目标库假定是空的（刚跑完 `npm run db:migrate` 建好表、还没写入任何数据），所以全部用普通 `insert`，不做 `onConflict` 兼容重跑——重复执行会因主键冲突报错，这是有意的安全闸：脚本不是幂等的，不应该被默默重跑两次。

- [ ] **Step 1: 创建迁移脚本**

Create `scripts/migrate-legacy-data.ts`:

```ts
import Database from "better-sqlite3"
import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import * as schema from "../lib/db/schema"

interface LegacyRepoRow {
  id: number
  full_name: string
  name: string
  owner_login: string
  owner_avatar: string | null
  description: string | null
  html_url: string
  language: string | null
  topics: string
  stargazers_count: number
  forks_count: number
  archived: number
  fork: number
  private: number
  is_template: number
  mirror_url: string | null
  pushed_at: string | null
  updated_at: string | null
  created_at: string | null
  is_owned: number
  is_starred: number
  starred_at: string | null
  synced_at: string | null
}

interface LegacyRepoUserDataRow {
  repo_id: number
  is_favorite: number
  note: string | null
  note_updated_at: string | null
}

interface LegacyTagRow {
  id: number
  name: string
  created_at: string
}

interface LegacyRepoTagRow {
  repo_id: number
  tag_id: number
}

async function main() {
  const legacyDbPath = process.argv[2]
  const userId = Number(process.env.MIGRATION_USER_ID)
  if (!legacyDbPath) {
    throw new Error(
      "用法: npm run db:migrate-legacy -- <本地 data/app.db 路径>",
    )
  }
  if (!Number.isInteger(userId)) {
    throw new Error("请设置环境变量 MIGRATION_USER_ID 为你的 GitHub 数字 id")
  }

  const legacy = new Database(legacyDbPath, { readonly: true })
  const repoRows = legacy
    .prepare("SELECT * FROM repos")
    .all() as LegacyRepoRow[]
  const userDataRows = legacy
    .prepare("SELECT * FROM repo_user_data")
    .all() as LegacyRepoUserDataRow[]
  const tagRows = legacy.prepare("SELECT * FROM tags").all() as LegacyTagRow[]
  const repoTagRows = legacy
    .prepare("SELECT * FROM repo_tags")
    .all() as LegacyRepoTagRow[]
  legacy.close()

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
  const db = drizzle(client, { schema })

  for (const row of repoRows) {
    await db.insert(schema.repos).values({
      id: row.id,
      fullName: row.full_name,
      name: row.name,
      ownerLogin: row.owner_login,
      ownerAvatar: row.owner_avatar,
      description: row.description,
      htmlUrl: row.html_url,
      language: row.language,
      topics: row.topics,
      stargazersCount: row.stargazers_count,
      forksCount: row.forks_count,
      archived: row.archived,
      fork: row.fork,
      private: row.private,
      isTemplate: row.is_template,
      mirrorUrl: row.mirror_url,
      pushedAt: row.pushed_at,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    })

    await db.insert(schema.userRepos).values({
      userId,
      repoId: row.id,
      isOwned: row.is_owned,
      isStarred: row.is_starred,
      starredAt: row.starred_at,
      syncedAt: row.synced_at,
    })
  }

  for (const row of userDataRows) {
    await db.insert(schema.repoUserData).values({
      userId,
      repoId: row.repo_id,
      isFavorite: row.is_favorite,
      note: row.note,
      noteUpdatedAt: row.note_updated_at,
    })
  }

  const tagIdMap = new Map<number, number>()
  for (const row of tagRows) {
    const [inserted] = await db
      .insert(schema.tags)
      .values({ userId, name: row.name, createdAt: row.created_at })
      .returning({ id: schema.tags.id })
    tagIdMap.set(row.id, inserted.id)
  }

  for (const row of repoTagRows) {
    const newTagId = tagIdMap.get(row.tag_id)
    if (newTagId === undefined) continue
    await db.insert(schema.repoTags).values({
      userId,
      repoId: row.repo_id,
      tagId: newTagId,
    })
  }

  const counts = {
    repos: (await db.select().from(schema.repos)).length,
    repoUserData: (await db.select().from(schema.repoUserData)).length,
    tags: (await db.select().from(schema.tags)).length,
    repoTags: (await db.select().from(schema.repoTags)).length,
  }
  const expected = {
    repos: repoRows.length,
    repoUserData: userDataRows.length,
    tags: tagRows.length,
    repoTags: repoTagRows.length,
  }

  console.log("迁移完成，行数核对：", { expected, actual: counts })

  const mismatched = (Object.keys(expected) as Array<keyof typeof expected>)
    .filter((key) => expected[key] !== counts[key])
  if (mismatched.length > 0) {
    throw new Error(
      `迁移后行数不一致：${mismatched.map((key) => `${key} 期望 ${expected[key]} 实际 ${counts[key]}`).join("; ")}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（此时 Task 1-7 的改动应已全部完成，整体应无错误）。

- [ ] **Step 3: 提交**

```bash
git add scripts/migrate-legacy-data.ts
git commit -m "$(cat <<'EOF'
feat: 新增本地旧数据迁移到 Turso 的一次性脚本

EOF
)"
```

- [ ] **Step 4: 实际执行迁移（人工操作，需要真实 Turso prod 凭据）**

1. 确认 `.env.local` 或命令行环境变量里 `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` 指向 `next-github-star-prod`（不是 dev 库）。
2. 对 prod 库跑一次 schema migration：`npm run db:migrate`。
3. 设置 `MIGRATION_USER_ID=<你的 GitHub 数字 id>`，执行：
   ```
   MIGRATION_USER_ID=<你的 GitHub 数字 id> npm run db:migrate-legacy -- data/app.db
   ```
4. 核对终端打印的行数与本地旧库的行数一致（可用 `sqlite3 data/app.db "SELECT count(*) FROM repos"` 等命令交叉核对）。
5. 确认无误后，`data/app.db` 保留归档，不删除。

---

## 部署清单（人工操作，非代码任务）

1. 确认 `docs/superpowers/plans/2026-06-25-github-oauth-login.md` 已完成并合并。
2. 在 Vercel 项目设置中配置生产环境变量：`AUTH_SECRET`、`AUTH_GITHUB_ID`、`AUTH_GITHUB_SECRET`、`ALLOWED_GITHUB_LOGINS`、`TURSO_DATABASE_URL`（指向 `next-github-star-prod`）、`TURSO_AUTH_TOKEN`。
3. 确认生产环境用的 GitHub OAuth App 回调地址已设置为 `https://<生产域名>/api/auth/callback/github`。
4. 执行 Task 8 Step 4，把本地旧数据迁移进 `next-github-star-prod`。
5. 部署到 Vercel（`vercel deploy --prod` 或通过 Git 集成自动部署）。
6. 部署后验证：访问生产域名自动跳转登录页；白名单账号登录成功；非白名单账号登录被拒绝；同步、收藏、备注、标签、star/unstar 全部正常；刷新页面/重新部署后数据仍在。

## 不在本计划范围内

- 不做 `repos` 表的并发写入冲突处理（个人量级、单一同步触发来源，足够简单）。
- 不做迁移脚本的回滚/重跑保护（见 Task 8 顶部说明，按设计不可重复执行）。
- 不删除本地 `data/app.db`（归档保留）。
- 不引入 Neon Postgres 或其他数据库（已在设计文档阶段比较并排除）。

