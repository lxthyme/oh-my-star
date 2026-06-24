# GitHub Starred Repo 管理工具 — 设计文档

- 日期：2026-06-24
- 状态：已确认，待生成实施计划

## 背景与约束

GitHub 自带的 Star 列表和仓库列表只能简单浏览，缺少个人化的整理手段：无法收藏、无法备注、无法打自定义标签，也无法按这些维度筛选。本项目要在现有 `next-github-star`（Next.js 16 + React 19 + antd，刚由 `create-next-app` 初始化，无任何后端/认证/数据库代码）的基础上，实现一个个人使用的 GitHub Star/仓库管理工具。

约束：

- **仅个人使用**（用户 lxthyme），无需多用户体系，认证可简化为 GitHub Personal Access Token（PAT），服务端持有，不下发到浏览器。
- **移动端 = 响应式 Web**，不做独立 App/小程序；同一套 Next.js 页面通过响应式布局适配手机浏览器。
- **本地运行**：部署目标未最终确定，但近期是本机/家庭网络环境跑着用，手机通过局域网访问。数据库选型按"本地优先、未来可迁移"设计。
- 项目内 `AGENTS.md` 指出此 Next.js 版本（16.2.9）相对训练知识有破坏性变更，实施阶段需要查阅 `node_modules/next/dist/docs/` 确认 App Router / Route Handlers / 缓存模型的最新约定（已初步确认：Route Handlers 默认不缓存、`fetch` 默认不缓存、支持 `RouteContext<'/path'>` 类型助手等）。

## 需求范围（来自用户原始描述，逐条映射到设计）

1. 管理工具支持移动端、web → 响应式 Web，见"页面结构"。
2. 分别加载已授权用户的 starred repo list 与当前用户的 repo list → 两个独立数据源 + 两个独立 Tab/路由。
3. 列表支持分页 → 服务端分页，本地 SQL `LIMIT/OFFSET`。
4. 筛选功能复刻 GitHub 官方筛选 → 见"筛选 / 排序 / 分页规格"。
5. 打标功能（下拉选择已有 tag 或新建 tag）→ `tags`/`repo_tags` 表 + antd `Select mode="tags"`。
6. 收藏/取消收藏 → 应用内独立标记 `repo_user_data.is_favorite`，与 GitHub star 无关。
7. 备注功能（查看/添加/编辑）→ `repo_user_data.note`。
8. 按收藏/备注/标签状态筛选 → 本地 SQL 筛选条件，GitHub API 无法支持，是本地缓存层存在的核心原因。
9. star/unstar 等基本操作 → 服务端代理 GitHub 写接口。

## 关键决策与取舍

### 决策 1：整体架构 — Next.js 全栈 + 本地 SQLite（已选定）

| 方案 | 说明 | 取舍 |
|---|---|---|
| **A. Next.js 全栈 + 本地 SQLite（选定）** | 复用现有 Next.js + antd；新增 `app/api/*` Route Handlers 代理 GitHub API（持有 PAT）、读写本地 SQLite | 单一代码库/单一部署单元，零额外服务进程，与现有项目结构契合 |
| B. 前后端分离（Next.js 前端 + 独立 Node/Express 后端） | 前后端独立部署 | 对个人工具是过度设计：多一套部署、CORS 配置，与"本机跑着用"场景不匹配，**否决** |
| C. 纯前端 + 浏览器端存储（IndexedDB/localStorage），无后端 | 零后端，部署成本最低 | 两个硬伤直接否决：① PAT 必须暴露在浏览器 JS 里，任何人打开页面源码都能拿到 token；② 手机和电脑各自一份 IndexedDB，数据不同步，违背"移动端+web 都要用"的需求 |

**决策依据**：方案 A 直接解决了 C 的两个硬伤（token 留在服务端、数据集中存储多端共享），又避免了 B 的过度工程，是个人本地工具场景下的明显最优解。

### 决策 2：本地缓存层是必需的，不是可选项

GitHub REST API 不支持"按收藏/备注/标签"筛选（这些概念在 GitHub 上根本不存在），也不支持把这些条件和 GitHub 原生筛选（语言/类型/排序）组合查询。因此必须把 GitHub 仓库数据同步进本地数据库，所有筛选/排序/分页都在本地 SQL 层完成，不依赖 GitHub API 的查询能力。

### 决策 3：数据分表 — GitHub 缓存数据与用户数据严格隔离

`repos`（GitHub 数据，每次同步整表 upsert）与 `repo_user_data`（收藏/备注，同步逻辑永不触碰）分成两张表，而不是合并成一张表里掺杂打勾字段。

**决策依据**：同步是"用 GitHub 最新数据覆盖本地缓存"的操作；如果用户数据和缓存数据混在同一行，覆盖逻辑必须每次小心地保留特定字段，一旦同步逻辑写错就会静默丢失用户的收藏/备注。分表后，同步代码只接触 `repos` 表，结构上保证不可能误删用户数据。

### 决策 4：GitHub star/unstar 与应用内"收藏"是两个独立标记

需求第 6 条（收藏）和第 9 条（star/unstar）字面上容易混淆。已与用户确认：两者独立 — GitHub star 是外部状态（`repos.is_starred`，来自同步），应用内"收藏"是本工具私有标记（`repo_user_data.is_favorite`），互不影响。

### 决策 5：两个数据源用两个独立 Tab/路由展示，而非合并列表

`/repos`（我的仓库）和 `/stars`（已 Star 仓库）是两个独立页面/路由，对应 GitHub 原生的两个 tab 体验；两者共享同一套筛选栏、列表、卡片组件，仅查询条件（`is_owned=1` vs `is_starred=1`）不同，避免重复实现。

### 决策 6：列表用 antd Card/List 而非 Table

Table 在窄屏下必须横向滚动，体验差，且要为移动端单独适配；Card/List 用 antd 响应式栅格天然支持单列（手机）到多列（桌面）的布局切换，一套组件覆盖两种屏幕尺寸。

### 决策 7：同步触发方式 — 手动刷新按钮

个人工具，访问频率低，不需要定时任务或后台 cron；页面上一个"同步"按钮，点击后全量拉取并 upsert，足够使用且实现最简单。

### 决策 8：技术选型细节

- **GitHub API 客户端**：`@octokit/rest`（官方维护，自带分页/限流处理，避免手写 Link header 解析）。
- **数据库**：`better-sqlite3` + Drizzle ORM。同步 API、零额外服务进程、TypeScript 类型安全、无 codegen 步骤，比 Prisma 更轻量，比手写 SQL 更安全；Drizzle 切换到 Postgres 驱动的迁移成本低，为未来可能的云端部署留了余地。
- **Token 配置**：`.env.local` 中 `GITHUB_TOKEN`，只在 Route Handler（Node.js runtime）中使用。

## 页面结构与路由

```
/repos   -- 我的仓库（owned），对应 GitHub repositories tab
/stars   -- 已 Star 仓库（starred），对应 GitHub stars tab
```

- 两个路由共享同一套筛选栏 + 列表 + 卡片组件，只是查询参数里数据源不同。
- 筛选条件通过 URL query string 同步（如 `?type=fork&lang=TypeScript&page=2`），可分享/刷新后保留状态。

## 筛选 / 排序 / 分页规格

**GitHub 原生筛选（两个 tab 通用，复刻 GitHub 官方体验）**

- 文本搜索：按名称/描述模糊匹配
- 类型：All / Sources / Forks / Archived / Templates
- 语言：动态生成（基于当前列表里出现过的 language 去重排序）
- 排序：Last updated / Name / Stars；`/stars` 额外支持 Recently starred

**本工具自有筛选（新增，GitHub 原生不支持）**

- 收藏状态：全部 / 已收藏 / 未收藏
- 备注状态：全部 / 已备注 / 未备注
- 标签：全部 / 未打标 / 指定某个或多个 tag

**分页**：服务端分页，默认每页 30 条（与 GitHub 一致），页码式分页控件（不用无限滚动，状态更可控、URL 可分享到具体某一页）。所有筛选/排序/分页转译成本地 SQL 查询：`repos LEFT JOIN repo_user_data LEFT JOIN repo_tags`，不依赖 GitHub API 的筛选能力。

## 标签 / 收藏 / 备注交互

- **打标**：每个 repo 卡片上有 Tag 选择器（antd `Select` `mode="tags"`），下拉展示当前已有 tag，支持直接输入新名称创建；选中后即时调用 API 保存。
- **收藏**：卡片上一个图标按钮（实心/空心切换），点击即时调用 API 切换 `is_favorite`，无需二次确认。
- **备注**：卡片上"备注"图标，点击弹出 antd `Modal`/`Popover` 编辑框，支持查看/编辑/保存；有内容时图标态高亮。

## Star / Unstar（GitHub 写操作）

- 卡片上 Star 按钮，调用 `PUT/DELETE /user/starred/{owner}/{repo}`（针对当前授权用户）。
- 操作成功后的本地状态更新：
  - 在 `/stars` 页面取消 star → 该条从列表移除，并更新本地缓存 `repos.is_starred = 0`。
  - 在 `/repos` 页面 star 自己的仓库 → 仅更新缓存 `repos.is_starred` 标记，不影响该条在 `/repos` 的展示（因为 `is_owned` 不变）。
- 写操作失败：toast 提示失败原因，UI 状态回滚，不假装成功。

## 同步机制

- 页面顶部"同步"按钮 → `POST /api/sync`：
  1. 用 octokit 分页拉取 `GET /user/repos`（owned）和 `GET /user/starred`（starred，使用 `application/vnd.github.star+json` media type 以获取 `starred_at`）。
  2. 全量 upsert 进 `repos` 表。
  3. 本次同步中未出现的旧记录，对应的 `is_owned`/`is_starred` 置 0（仓库被删除或取消 star 后不再出现在列表里），但**不删除** `repo_user_data` 中的收藏/备注/标签关联 — 万一以后重新 star 回来，历史标记还在。
- 同步过程中前端显示 loading 状态；同步失败（网络异常/token 失效/触发限流）展示明确错误提示，不影响已缓存数据的可用性（旧数据继续展示）。

## 错误处理

- GitHub Token 未配置/失效 → API 路由统一返回 401，前端提示检查 `.env.local`。
- GitHub API 限流（403 + `X-RateLimit-Remaining: 0`）→ 同步接口捕获并提示"已达 GitHub API 限流，请稍后重试"。
- Star/Unstar 等写操作失败 → toast 提示失败原因，UI 状态回滚。

## 测试策略

- Vitest 覆盖数据层单测：`repos`/`repo_user_data`/`tags` 的 CRUD、筛选条件转 SQL 的拼装逻辑、sync 的 upsert 逻辑（尤其是"未出现的旧记录置 0 但不删用户数据"这条规则）。
- 不做端到端测试：个人工具，手动验收已足够，自动化 E2E 的投入产出比不划算。

## 数据模型

**`repos`（GitHub 数据缓存，每次同步整表 upsert）**

```
id                INTEGER PK   -- GitHub repo id（稳定，不随改名变化）
full_name         TEXT         -- owner/repo
name              TEXT
owner_login       TEXT
owner_avatar      TEXT
description       TEXT
html_url          TEXT
language          TEXT
topics            TEXT         -- JSON 数组序列化
stargazers_count  INTEGER
forks_count       INTEGER
archived          INTEGER      -- 0/1
fork              INTEGER      -- 0/1
private           INTEGER      -- 0/1
is_template       INTEGER      -- 0/1
pushed_at         TEXT         -- 最近 push 时间
updated_at        TEXT         -- 最近更新时间
created_at        TEXT         -- 仓库创建时间
is_owned          INTEGER      -- 0/1，来自 /user/repos
is_starred        INTEGER      -- 0/1，来自 /user/starred
starred_at        TEXT         -- nullable，star 时间（仅 is_starred=1 时有值）
synced_at         TEXT
```

`is_owned`/`is_starred` 用两个布尔字段而非两行数据，用于处理"自己 star 了自己仓库"这种两个来源重叠的情况。

**`repo_user_data`（用户数据，同步逻辑永不触碰）**

```
repo_id          INTEGER PK   -- FK -> repos.id
is_favorite      INTEGER      -- 0/1，应用内收藏，独立于 GitHub star
note             TEXT
note_updated_at  TEXT
```

**`tags` / `repo_tags`（标签，多对多）**

```
tags:      id PK, name UNIQUE NOT NULL, created_at
repo_tags: repo_id FK, tag_id FK, PRIMARY KEY(repo_id, tag_id)
```

## 涉及的文件路径（概览）

```
app/
  repos/page.tsx                      -- 我的仓库 tab
  stars/page.tsx                      -- 已 Star 仓库 tab
  components/
    RepoList.tsx                       -- 共享列表（筛选栏 + 分页 + Card 网格）
    RepoCard.tsx                       -- 单个 repo 卡片（标签/收藏/备注/star 按钮）
    TagSelect.tsx
    NoteEditor.tsx
  api/
    sync/route.ts                      -- POST 触发全量同步
    repos/route.ts                      -- GET 列表（筛选/排序/分页查询参数）
    repos/[id]/favorite/route.ts        -- PATCH 收藏切换
    repos/[id]/note/route.ts            -- PATCH 备注
    repos/[id]/tags/route.ts            -- GET/PUT 标签关联
    repos/[id]/star/route.ts            -- PUT/DELETE 触发 GitHub star/unstar
    tags/route.ts                        -- GET 全部 tag / POST 新建
lib/
  db/
    schema.ts                           -- Drizzle schema
    client.ts                            -- better-sqlite3 连接
    queries.ts                            -- 筛选/排序/分页 SQL 拼装
  github.ts                              -- octokit 封装（list owned/starred、star/unstar）
data/app.db                               -- SQLite 文件（需加入 .gitignore）
```

## 开放问题 / 风险

- **部署目标未最终确定**：当前按"本地运行 + SQLite"设计；若未来要迁移到云端部署，需要把 `better-sqlite3` 换成 Postgres 驱动（Drizzle 迁移成本低，但仍是后续工作量，不在本次范围内）。
- **GitHub API 限流**：未认证请求限流为 60 次/小时，认证后为 5000 次/小时；个人仓库+star 数量较大时，全量同步可能需要多次分页请求，正常情况下不会触发限流，但需要在实施阶段验证实际仓库规模下的请求次数。
- **Next.js 16 的破坏性变更**：本次设计未深入验证所有 App Router/Route Handlers 细节（如 Cache Components、`RouteContext` 类型生成）是否影响实现，实施阶段需要按 `AGENTS.md` 要求查阅 `node_modules/next/dist/docs/` 确认具体写法。
- **`better-sqlite3` 原生模块**：是同步 API 的原生 Node 扩展，需要确认目标运行环境（Node 版本、操作系统）能正常编译/安装，若未来打算用 Docker 部署需要注意原生模块的跨平台编译问题。
- **starred 接口响应结构差异**：`/user/starred` 在使用 `application/vnd.github.star+json` media type 时，响应结构是 `{ starred_at, repo }` 的包装对象，与 `/user/repos` 直接返回仓库对象数组的结构不同，实施阶段需要专门处理这层差异。
