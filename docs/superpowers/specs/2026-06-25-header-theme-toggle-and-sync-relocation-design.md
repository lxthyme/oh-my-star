# 头部主题切换 + 同步按钮迁移 — 设计文档

- 日期：2026-06-25
- 状态：已确认，待生成实施计划

## 背景

当前 `AppShell.tsx` 仅通过 `prefers-color-scheme` 自动探测明暗主题，用户无法手动切换。同步按钮与同步状态目前内嵌在 `RepoList.tsx` 中，只服务当前页面，且页面上看不到"上次同步时间"。本次在顶部菜单栏新增主题切换按钮，并将同步按钮迁移到顶部菜单、同时展示上次同步时间。

## 需求范围

1. 顶部菜单栏增加按钮，可手动切换主题：亮色 / 暗色 / 跟随系统（三态）。
2. 同步按钮从 `RepoList.tsx` 移动到顶部菜单（全局可见），点击后仍需让当前页面列表刷新。
3. 顶部菜单展示"上次同步时间"，格式为绝对时间。

## 关键决策

### 决策 1：主题三态而非二态

用户明确要求亮色/暗色/跟随系统三态，而非"点击切换二态、记住后不再跟随系统"的简化方案。三态需要一个菜单（`Dropdown`）而非简单的二态切换按钮。

### 决策 2：主题持久化与防闪烁 — 遵循 Next.js 16 官方 inline script 方案

`node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` 明确给出了主题场景的标准做法：在 `<html>` 上设默认 `data-theme` 属性 + `suppressHydrationWarning`，`<head>` 内放一段同步执行的 inline `<script>`，在首次绘制前读取 `localStorage` 并设置 `data-theme`，CSS 用 `[data-theme='dark']` 选择器而非 `@media (prefers-color-scheme: dark)`。本项目直接采用该官方方案，不引入 `next-themes` 等第三方依赖（YAGNI，三态切换逻辑足够简单，手写即可）。

### 决策 3：同步状态从页面级状态提升为全局 Context

`RepoList.tsx` 原先的 `syncing`/`handleSync` 是组件内部状态，迁移到全局头部后，头部按钮与当前页面列表分属两个组件树分支，必须通过共享状态桥接。新增 `SyncContext`（`SyncProvider` + `useSync()`），暴露：

- `lastSyncedAt: string | null` — 上次同步时间（ISO 字符串），挂载时通过 `GET /api/sync` 从数据库读取初始值。
- `syncing: boolean`
- `syncVersion: number` — 每次同步成功自增；`RepoList` 将其纳入 `fetchRepos` 的依赖数组，头部触发同步后当前页面列表自动刷新，无需 prop drilling 或自定义事件。
- `triggerSync(): Promise<void>` — 封装原 `POST /api/sync` 调用 + 成功/失败提示。

**决策依据**：相比 `router.refresh()`（对纯客户端 fetch 的组件无效）或自定义 `window` 事件（隐式耦合、类型不安全），React Context 是这个场景里接口最清晰的方案——状态与触发函数都有明确类型签名，订阅方只需一行 `useSync()`。

### 决策 4：上次同步时间的数据来源 — 复用 `repos.synced_at`，不加新表

`repos` 表每行已有 `synced_at` 字段（每次同步 upsert 时写入当前时间）。"上次同步时间"直接查 `MAX(synced_at)`，不需要额外的 settings/meta 表。`app/api/sync/route.ts` 新增 `GET` handler 返回 `{ lastSyncedAt }`。

### 决策 5：时间格式 — 绝对时间，不做相对时间实时刷新

用户选择绝对时间（如 `06-25 14:32`）。相对时间（"3 分钟前"）需要定时器持续刷新组件才能保持准确，对个人工具是不必要的复杂度；绝对时间渲染一次即可，且通过 `Tooltip` 始终可查看完整时间。

## 架构与组件改动

### 新增文件

- `app/lib/theme.ts`：纯模块，无 `"use client"`。
  - `type ThemeMode = "light" | "dark" | "system"`
  - `THEME_STORAGE_KEY` 常量
  - `THEME_INLINE_SCRIPT`：字符串常量，供 `layout.tsx` 的 `<script dangerouslySetInnerHTML>` 使用。逻辑：读 `localStorage[THEME_STORAGE_KEY]`；若值为 `light`/`dark` 直接用；若为空或 `system`，用 `matchMedia('(prefers-color-scheme: dark)')` 结果；最终把 resolve 出的 `light`/`dark` 写入 `document.documentElement.dataset.theme`。
- `app/components/SyncContext.tsx`：`"use client"`。
  - `SyncProvider`：内部状态 `lastSyncedAt`/`syncing`/`syncVersion`；挂载时 `GET /api/sync`；导出 `triggerSync`。
  - `useSync()`：读取 context，未包裹时抛错（开发期尽早暴露用法错误）。

### 修改文件

- `app/layout.tsx`：`<html lang="zh-CN" data-theme="light" suppressHydrationWarning>`；新增 `<head>`，内含注入 `THEME_INLINE_SCRIPT` 的 `<script>`。
- `app/globals.css`：暗色变量选择器由 `@media (prefers-color-scheme: dark) { :root { ... } }` 改为 `html[data-theme='dark'] { ... }`。
- `app/components/AppShell.tsx`：
  - 移除 `useIsDarkMode`，新增 `useThemeMode()`：懒初始化读取 `localStorage`（默认 `"system"`），`matchMedia` 监听仅在 `mode === "system"` 时用于计算 `isDark`；`setMode(next)` 同步写 `localStorage` + `document.documentElement.dataset.theme` + state。返回 `{ mode, isDark, setMode }`；`isDark` 继续驱动 antd `ConfigProvider` 的 `algorithm`。
  - 头部新增主题按钮：`Dropdown` 触发，图标按当前 `mode` 显示（`SunOutlined`/`MoonOutlined`/`DesktopOutlined`），菜单三项对应三态。
  - 用 `SyncProvider` 包裹 `Layout`；头部新增同步图标按钮（`SyncOutlined spin={syncing}`，点击调用 `triggerSync()`）与上次同步时间文本（`hidden sm:inline` 窄屏隐藏文本，保留 `Tooltip` 显示完整时间；`lastSyncedAt === null` 时显示"从未同步"）。
- `app/api/sync/route.ts`：新增 `GET`，查询 `MAX(repos.synced_at)`，返回 `{ lastSyncedAt: string | null }`。
- `app/components/RepoList.tsx`：
  - 删除 `syncing` 状态、`handleSync`、`SyncOutlined` 导入、头部 `Button`（同步）。
  - 改用 `useSync()` 取 `syncVersion`，加入 `fetchRepos`（`useCallback`）依赖数组。
  - 原先为容纳同步按钮搭建的 `Row justify="space-between"` + 两个 `Col` 包裹简化为单一容器包裹 `FilterBar`（`Row`/`Col` 仍用于下方仓库卡片栅格，不删除该 import）。

## 移动端考虑

头部已有 logo + 导航 Menu，本次新增同步图标按钮、上次同步时间文本（窄屏隐藏）、主题按钮，均为图标为主、`flex-shrink: 0`，不依赖横向展开的文字标签（除可隐藏的同步时间），避免在小屏进一步挤压导航 Menu 的可用宽度。

## 测试要点

- `app/api/sync/route.ts` 的 `GET`：无 `repos` 记录时返回 `lastSyncedAt: null`；有记录时返回 `MAX(synced_at)`。
- 主题三态切换：`localStorage` 写入正确值；`document.documentElement.dataset.theme` 与 antd `algorithm` 同步更新。
- `SyncContext`：`triggerSync` 成功后 `syncVersion` 自增，失败时不增且展示错误提示。
- `RepoList`：`syncVersion` 变化触发 `fetchRepos` 重新调用（可通过 mock fetch 调用次数验证）。

## 不在本次范围内

- 不引入 `next-themes` 或其他主题库。
- 不新增 settings/meta 表存储同步时间，复用 `repos.synced_at`。
- 不做相对时间实时刷新。
- 不做同步失败重试或定时自动同步。
