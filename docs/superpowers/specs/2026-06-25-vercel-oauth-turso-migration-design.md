# 部署到 Vercel：GitHub OAuth 登录 + Turso 数据库迁移 — 设计文档

- 日期：2026-06-25
- 状态：已确认，待生成实施计划

## 背景

当前应用用 `better-sqlite3` + `drizzle-orm` 读写本地文件 `data/app.db`，无任何认证（`app/api/sync/route.ts`、`app/api/repos/[id]/star/route.ts` 直接用 `.env.local` 里的静态 `GITHUB_TOKEN` 调 GitHub API）。Vercel 的 serverless 函数没有持久化磁盘，部署上去会导致每次冷启动/多实例间数据不一致甚至丢失；同时部署后会拿到一个公开 URL，没有访问控制的话任何人都能看到仓库列表、个人收藏与备注。

本次设计要解决两个问题：（1）用 GitHub OAuth 登录替代静态 token，顺带解决访问控制；（2）把数据库从本地 SQLite 文件迁移到可在 Vercel 上持久化的网络数据库。

## 需求范围

1. GitHub OAuth 登录，仅允许白名单中的 GitHub 账号登录成功。
2. 登录后用 OAuth access token 调 Octokit 抓取仓库数据，替代静态 `GITHUB_TOKEN`。
3. 数据库迁移到 Turso（libSQL），schema 加 `user_id` 预留多租户能力（即使目前只有 1 个允许登录的账号）。
4. 本地 `data/app.db` 中已有的仓库列表、收藏、备注、标签一次性迁移到 Turso。
5. 本地开发与生产环境分别连接各自独立的 Turso database（dev / prod），均为远程连接,不再依赖本地 SQLite 文件。

## 关键决策

### 决策 1：认证用 Auth.js GitHub Provider + 白名单，而非 Vercel 平台密码保护

Vercel 自带的 Deployment Protection 密码保护通常需要 Pro 付费计划。GitHub OAuth 登录既能挡住未授权访问（`signIn` 回调里校验 `profile.login` 是否在环境变量 `ALLOWED_GITHUB_LOGINS` 白名单中,不在白名单拒绝登录），又能拿到用户自己的 access token 用来调 GitHub API，一举两得，免费。采用 JWT session 策略（access token 存进 JWT），不引入数据库 session adapter,避免多一张表。

### 决策 2：数据归属模型加 `user_id`，预留多租户能力

尽管实际只会有 1 个账号登录成功，用户明确要求现在加 `user_id`，避免以后真要开放给第二个人用时再做痛苦的 schema 迁移。

### 决策 3：数据库选型用 Turso（libSQL），而非 Neon Postgres（Vercel Marketplace）

两者都是网络数据库，离开本地文件 SQLite 后，`lib/db/*.ts` 里所有同步 API（`.get()`/`.all()`/`.run()`/同步 `transaction`）**都必须改成 `async/await`**——这是任何网络数据库都绕不开的代价，不是 Postgres 独有的。

在此前提下两者的差异：

| | Turso (libSQL) | Neon Postgres |
|---|---|---|
| Schema 改动 | `schema.ts` 仍是 `sqlite-core`，现有的整数模拟布尔、JSON 存 text 写法可以照搬 | 需要整套改写成 `pg-core`，类型系统重新设计 |
| Vercel 集成 | 手动配置 `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` 两个环境变量 | Marketplace 一键关联，环境变量自动注入 |
| 分支隔离 | 创建 2 个独立 database 区分 dev/prod | 原生 branch 功能 |

这是个人量级的 4~5 张表小应用，用不上 Postgres 的关系能力优势,Turso 用最小改造成本拿到同等能力，因此选 Turso。

排除掉的选项：Vercel/Upstash 这类 KV-Redis 存储——`repo_tags` 是多对多关联查询，KV 模型不适合，不考虑。

### 决策 4：拆表 — `repos`（全局元数据缓存）与 `user_repos`（每用户关系）分离

当前 `repos` 表把"仓库元数据"（名字、描述、star 数……）和"我与这个仓库的关系"（是否 owned/starred、何时 star 的）混存一行。多用户后两者要拆开：仓库元数据对所有用户是同一份，关系数据是每个用户私有的。`repo_user_data`（收藏/备注）与 `tags`/`repo_tags`（标签）同理需要加 `user_id` 隔离。

隐私角度：全局共享的 `repos` 缓存不会跨用户泄露私有仓库——GitHub API 只会把"当前登录用户能看到的仓库"同步进来，别人即使共用这张缓存表，也不会通过自己的 `user_repos` 关联查到他本来看不到的仓库。

### 决策 5：不建 `users` 表

Auth.js 的 JWT session 里已经带着 GitHub profile（数字 id、login、avatar），数据库里没必要再存一份冗余数据。各表的 `user_id` 直接用 GitHub 的数字 user id（稳定，不随改名变化）。

## 数据流

### 认证流程

1. 用户访问任意页面 → 中间件检测无 session → 跳转登录页。
2. 点击"用 GitHub 登录" → Auth.js 走 GitHub OAuth 授权 → 回调时 `signIn` 回调校验 `profile.login` 是否在 `ALLOWED_GITHUB_LOGINS` 白名单 → 不在白名单则拒绝并跳回登录页提示无权限。
3. 通过校验后，access token 写入 JWT session；后续请求从 session 中取 `userId`（GitHub 数字 id）与 access token。

### 同步流程（`app/api/sync/route.ts`）

1. 从 session 取当前用户的 access token，创建 Octokit client（不再读 `.env.local` 的 `GITHUB_TOKEN`）。
2. 抓取 owned + starred 仓库列表。
3. Upsert 写入全局 `repos` 表（仓库元数据,跟 `user_id` 无关）。
4. 针对当前 `user_id`，重置并重新写入 `user_repos` 表的 `is_owned`/`is_starred`/`starred_at`/`synced_at`（逻辑与现在的 `syncRepos` 类似，作用范围从整张表收窄到"当前用户的关系行"）。

### 列表查询流程（`lib/db/repos.ts`）

原来对 `repos` 单表的查询，改为 `repos` JOIN `user_repos`（按 session 中的 `user_id` 过滤）再 LEFT JOIN `repo_user_data`、`tags`/`repo_tags`（同样按 `user_id` 过滤）。具体 JOIN 写法留到实施计划阶段确定。

## Schema 设计

```
repos                 -- 全局仓库元数据缓存，无 user_id
  id, full_name, name, owner_login, owner_avatar, description,
  html_url, language, topics, stargazers_count, forks_count,
  archived, fork, private, is_template, mirror_url,
  pushed_at, updated_at, created_at

user_repos (新增)      -- 每用户与仓库的关系
  user_id, repo_id, is_owned, is_starred, starred_at, synced_at
  PRIMARY KEY (user_id, repo_id)

repo_user_data         -- 加 user_id
  user_id, repo_id, is_favorite, note, note_updated_at
  PRIMARY KEY (user_id, repo_id)

tags                   -- 加 user_id，唯一约束变为按用户隔离
  id, user_id, name, created_at
  UNIQUE (user_id, name)

repo_tags              -- 加 user_id
  user_id, repo_id, tag_id
  PRIMARY KEY (user_id, repo_id, tag_id)
```

## 数据迁移方案

1. 在 Turso 创建 dev、prod 两个 database，跑 drizzle migration 生成上述新 schema。
2. 写一个一次性脚本：读出本地 `data/app.db`（better-sqlite3）里 `repos`/`repo_user_data`/`tags`/`repo_tags` 的全部数据，按新结构拆分写入 Turso prod database——`repos` 只保留元数据字段，关系字段写入 `user_repos`；所有迁移数据的 `user_id` 写死为登录用的 GitHub 数字 id。
3. 跑一次脚本，核对迁移前后数量一致。
4. 本地 `data/app.db` 归档保留，不删除。

## 环境变量

- `AUTH_SECRET` — Auth.js 加密 session
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` — 需新建一个 GitHub OAuth App，回调地址填生产域名
- `ALLOWED_GITHUB_LOGINS` — 逗号分隔的白名单 GitHub 用户名
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — dev、prod 各一套，分别配置在 `.env.local` 与 Vercel 项目设置中

## 测试要点

- `lib/db/*.test.ts`（`client`/`repos`/`sync`/`tags`/`user-data`）现有同步测试全部改为 `async/await`；libSQL client 支持内存模式，测试不需要真实联网。
- OAuth `signIn` 回调：白名单内账号允许登录，白名单外账号拒绝。
- 同步逻辑：验证 `user_repos` 的重置/重新写入只影响当前 `user_id`，不影响 `repos` 全局表中其他用户可能写入的数据。
- 数据迁移脚本：迁移前后 `repos`/`tags`/`repo_user_data`/`repo_tags` 行数一致性校验。

## 部署落地顺序

1. 创建 GitHub OAuth App（获取 client id/secret，登记回调地址）。
2. 创建 Turso 账号 + dev、prod 两个 database。
3. 配置环境变量（本地 `.env.local` + Vercel 项目设置）。
4. 跑 drizzle-kit migration 生成新 schema。
5. 改造 `lib/db` 层：异步化 + 多租户拆表（`repos`/`user_repos`/`repo_user_data`/`tags`/`repo_tags`）。
6. 接入 Auth.js（GitHub provider + 白名单回调 + JWT session），中间件保护所有页面/API 路由。
7. 写并跑数据迁移脚本，把本地数据搬到 Turso prod。
8. 部署到 Vercel，验证：未登录跳转登录页、白名单外账号被拒绝、登录后同步与数据读写正常。

## 不在本次范围内

- 不做完整的多用户产品化（界面上不会出现"邀请其他用户"之类的功能，schema 只是预留能力）。
- 不采用 Neon Postgres / Vercel Marketplace 数据库。
- 不使用 Vercel Deployment Protection 密码保护。
- 不做数据库 session adapter（如 `@auth/drizzle-adapter`），session 全部走 JWT。
- 不做仓库元数据的多用户并发写入冲突处理（当前个人量级、单一同步触发来源，足够简单）。
