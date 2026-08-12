# 构建版本元数据脚本使用指南

本文说明如何在 Next.js 与 Vue + Vite 项目中使用构建版本元数据脚本，统一生成并注入以下公开信息：

| 变量              | 含义                           | 示例                         |
| ----------------- | ------------------------------ | ---------------------------- |
| `APP_VERSION`     | 当前构建使用的应用版本         | `0.1.1`                      |
| `APP_GIT_SHA`     | 当前构建对应的短 Git SHA       | `8b9f8f2`                    |
| `APP_GIT_MESSAGE` | 当前构建对应的 Git commit 标题 | `feat: add release metadata` |

这些变量会进入浏览器构建产物，不得放入 token、密码或其他敏感信息。

## 快速导航

- [通用模块 API](#通用模块-api)
- [独立版本提交](#独立版本提交)
- [Next.js 项目](#nextjs-项目)
- [Vue + Vite 项目](#vue--vite-项目)
- [Vercel 部署](#vercel-部署)
- [其他 CI/CD 平台](#其他-cicd-平台)
- [常见问题](#常见问题)

## 适用范围

脚本分为通用核心和项目入口：

| 文件                                | 是否通用     | 职责                                                           |
| ----------------------------------- | ------------ | -------------------------------------------------------------- |
| `scripts/app-metadata.mjs`          | 是           | 解析版本、Git 元数据、Vercel 回退值，执行子进程并同步 manifest |
| `scripts/run-with-app-metadata.mjs` | 是           | 为开发命令注入当前元数据，不递增版本                           |
| `scripts/build-with-version.mjs`    | Next.js 专用 | 执行 `next build`，成功后持久化 patch 版本                     |
| `scripts/deploy-production.mjs`     | Vercel 专用  | 向 Vercel 远端构建传入元数据，部署成功后持久化本地版本         |
| `scripts/version-commit.mjs`        | npm + Git    | 按 release type 更新 manifest 并创建独立的本地 release commit  |

通用核心当前面向 npm 项目，持久化版本时会同步修改：

- `package.json.version`
- `package-lock.json.version`
- `package-lock.json.packages[""].version`

使用 pnpm、Yarn 或不含根包条目的旧 lockfile 时，需要为相应 lockfile 实现独立的持久化适配，不能直接复用当前 `persistPackageVersion()`。

## 通用模块 API

`scripts/app-metadata.mjs` 导出以下接口：

| 接口                                   | 作用                                | 失败行为                               |
| -------------------------------------- | ----------------------------------- | -------------------------------------- |
| `incrementVersion(version, type?)`     | 按 patch、minor 或 major 递增版本   | 版本格式或 release type 无效时抛错     |
| `readPackageVersion(cwd?)`             | 读取并校验 `package.json.version`   | 文件无效或版本格式错误时抛错           |
| `readGitMetadata(cwd?)`                | 读取短 SHA 和最新 commit 标题       | Git 不可用时返回空值，由解析层继续回退 |
| `resolveAppMetadata(options)`          | 按统一优先级生成三个 `APP_*`        | 没有 Git 或 CI 值时使用 `unknown`      |
| `persistPackageVersion(version, cwd?)` | 同步写入 npm 的 package 与 lockfile | 写入前校验 lockfile 根包结构           |
| `runCommand(command, args, env)`       | 使用参数数组执行子进程并继承 stdio  | 启动失败时抛错，否则返回退出码         |

入口脚本通过 `process.exitCode` 透传目标命令的状态。调用方可以依赖非零退出码阻止后续发布步骤。

## 运行要求

- 项目必须是 Git 工作区，或者由 CI 显式提供 `APP_GIT_SHA` 和 `APP_GIT_MESSAGE`。
- `package.json.version` 必须是严格的三段式数字版本，例如 `1.4.2`。
- 使用当前 Next.js 16 项目时应使用 Node.js 20.9 或更高版本。
- `node`、目标框架 CLI 以及 `npx` 必须能从当前 `PATH` 找到。

先检查实际运行环境：

```bash
node --version
npm --version
git rev-parse --short HEAD
```

## 元数据解析规则

版本解析顺序：

```text
显式 APP_VERSION
→ 调用入口传入的 package.json 版本或下一 patch 版本
```

Git 元数据解析顺序：

```text
显式 APP_GIT_SHA / APP_GIT_MESSAGE
→ 本地 Git
→ VERCEL_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_MESSAGE
→ unknown
```

本地 Git 优先使 `dev` 和本地 `build` 不依赖部署平台。Vercel 变量只处理远端构建目录没有 `.git` 的情况。其他 CI/CD 平台应在执行构建前转换为标准的 `APP_*` 变量，不需要把平台逻辑加入应用代码。

## 版本更新语义

| 命令                              | 构建使用的版本                     | 是否写回本地 manifest |
| --------------------------------- | ---------------------------------- | --------------------- |
| `npm run dev`                     | 当前 `package.json.version`        | 否                    |
| `npm run build`                   | 下一 patch 版本                    | 构建成功后写回        |
| `APP_VERSION=2.0.0 npm run build` | 显式版本 `2.0.0`                   | 否                    |
| `npm run prd`                     | 下一 patch 版本                    | 部署成功后写回        |
| `npm run version:commit -- minor` | 下一 minor 版本                    | 写回并创建本地 commit |
| 直接运行 `vercel deploy --prod`   | Vercel 临时目录中的下一 patch 版本 | 不会写回本地或 Git    |

失败的构建或部署不会消耗版本号。包装器只有在子进程退出码为 `0` 时才更新两个 manifest。

## 独立版本提交

`version:commit` 只更新版本并创建本地 commit，不执行 build、deploy、tag 或 push。

```bash
npm run version:commit          # 0.1.2 → 0.1.3
npm run version:commit -- patch # 0.1.2 → 0.1.3
npm run version:commit -- minor # 0.1.2 → 0.2.0
npm run version:commit -- major # 0.1.2 → 1.0.0
```

commit message 固定为：

```text
chore(release): v0.1.3
```

执行前，`package.json` 和 `package-lock.json` 在工作区及暂存区都必须干净；否则命令会拒绝运行，不会覆盖或继续递增已有修改。仓库中的其他文件可以处于已修改或已暂存状态。

release commit 使用 `git commit --only`，因此只包含两个 manifest。其他已暂存内容不会进入该 commit，并且在命令完成后仍保持暂存。

如果 `git commit` 或 Git hook 失败，递增后的 manifest 会保留在工作区供检查或重试，脚本不会自动回滚。重试前需要先处理失败原因和目标文件状态。

## Next.js 项目

### 1. 复制脚本

复制以下文件到目标项目的 `scripts/`：

```text
scripts/
├── app-metadata.mjs
├── build-with-version.mjs
├── deploy-production.mjs
├── run-with-app-metadata.mjs
└── version-commit.mjs
```

如果不使用 Vercel，可以不复制 `deploy-production.mjs`。

### 2. 配置 npm scripts

```json
{
  "scripts": {
    "dev": "node scripts/run-with-app-metadata.mjs next dev",
    "build": "node scripts/build-with-version.mjs",
    "start": "next start",
    "prd": "node scripts/deploy-production.mjs",
    "version:commit": "node scripts/version-commit.mjs"
  }
}
```

端口等 Next.js 参数直接放在被包装命令后面：

```json
"dev": "node scripts/run-with-app-metadata.mjs next dev --port 6602"
```

### 3. 配置 `next.config.ts`

```ts
import type { NextConfig } from "next"
import { readFileSync } from "node:fs"
import path from "node:path"

const pkg = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
)

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: process.env.APP_VERSION ?? pkg.version,
    APP_GIT_SHA: process.env.APP_GIT_SHA ?? "unknown",
    APP_GIT_MESSAGE: process.env.APP_GIT_MESSAGE ?? "unknown",
  },
}

export default nextConfig
```

`next.config.ts` 的 `env` 会把这些值内联到浏览器 bundle，因此不要求变量名使用 `NEXT_PUBLIC_`。构建完成后修改 shell 环境变量不会改变既有产物，必须重新构建。参见 [Next.js `env` 配置](https://nextjs.org/docs/app/api-reference/config/next-config-js/env)和[环境变量指南](https://nextjs.org/docs/app/guides/environment-variables)。

### 4. 在组件中读取

必须使用静态属性访问，避免动态变量名：

```tsx
export function BuildInfo() {
  return (
    <span title={process.env.APP_GIT_MESSAGE}>
      v{process.env.APP_VERSION} · {process.env.APP_GIT_SHA}
    </span>
  )
}
```

不要写成：

```ts
const key = "APP_VERSION"
process.env[key]
```

动态索引不会被可靠地内联到客户端产物。

### 5. 可选的 TypeScript 声明

在项目的 `environment.d.ts` 中添加：

```ts
declare namespace NodeJS {
  interface ProcessEnv {
    readonly APP_VERSION: string
    readonly APP_GIT_SHA: string
    readonly APP_GIT_MESSAGE: string
  }
}
```

## Vue + Vite 项目

Vite 客户端代码使用 `import.meta.env`，不能直接使用 Node.js 的 `process.env`。推荐在 `vite.config.ts` 中显式列出允许公开的三个变量，而不是开放整个 `APP_` 前缀，以避免未来误暴露同前缀的敏感变量。

Vite 会在开发时提供这些常量，并在生产构建时进行静态替换。修改 Git commit 或环境变量后需要重启开发服务器。参见 [Vite 环境变量指南](https://vite.dev/guide/env-and-mode)和[`define` 配置](https://vite.dev/config/shared-options#define)。

### 1. 复制通用脚本

复制：

```text
scripts/
├── app-metadata.mjs
├── deploy-production.mjs
├── run-with-app-metadata.mjs
└── version-commit.mjs
```

然后为 Vite 新建 `scripts/build-vite-with-version.mjs`：

```js
import {
  incrementVersion,
  persistPackageVersion,
  readPackageVersion,
  resolveAppMetadata,
  runCommand,
} from "./app-metadata.mjs"

// 部署包装器会预先注入版本；远端 build 直接消费它，避免同一次部署再次自增。
const explicitVersion = process.env.APP_VERSION?.trim()
const version =
  explicitVersion ?? incrementVersion(readPackageVersion(), "patch")
const metadata = resolveAppMetadata({ version })
const status = runCommand("vite", ["build"], {
  ...process.env,
  ...metadata,
})

if (status === 0 && !explicitVersion) {
  // 失败构建不消耗版本号，manifest 只记录实际成功产出的版本。
  persistPackageVersion(version)
}

process.exitCode = status
```

### 2. 配置 npm scripts

```json
{
  "scripts": {
    "dev": "node scripts/run-with-app-metadata.mjs vite",
    "build": "node scripts/build-vite-with-version.mjs",
    "preview": "vite preview",
    "prd": "node scripts/deploy-production.mjs",
    "version:commit": "node scripts/version-commit.mjs"
  }
}
```

如果项目习惯使用 `vite --host 0.0.0.0`，可以继续把参数放在被包装命令后：

```json
"dev": "node scripts/run-with-app-metadata.mjs vite --host 0.0.0.0"
```

### 3. 配置 `vite.config.ts`

```ts
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  define: {
    "import.meta.env.APP_VERSION": JSON.stringify(
      process.env.APP_VERSION ?? "unknown",
    ),
    "import.meta.env.APP_GIT_SHA": JSON.stringify(
      process.env.APP_GIT_SHA ?? "unknown",
    ),
    "import.meta.env.APP_GIT_MESSAGE": JSON.stringify(
      process.env.APP_GIT_MESSAGE ?? "unknown",
    ),
  },
})
```

这里不需要 `loadEnv()`：包装脚本已经在启动 Vite 前把三个值放入子进程的 `process.env`。如果还需要读取 `.env.*` 文件中的其他非默认前缀变量，再单独使用 Vite 的 `loadEnv()`。

### 4. 添加客户端类型声明

在 `src/vite-env.d.ts` 中添加：

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_VERSION: string
  readonly APP_GIT_SHA: string
  readonly APP_GIT_MESSAGE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

### 5. 在 Vue 组件中读取

```vue
<script setup lang="ts">
const version = import.meta.env.APP_VERSION
const gitSha = import.meta.env.APP_GIT_SHA
const gitMessage = import.meta.env.APP_GIT_MESSAGE
</script>

<template>
  <span :title="gitMessage">v{{ version }} · {{ gitSha }}</span>
</template>
```

## Vercel 部署

使用前确保 Vercel CLI 已完成登录，并且当前目录已经关联到正确项目。生产部署会改变外部状态，脚本不会自动确认目标项目或回滚部署。

推荐使用：

```bash
npm run prd
```

`deploy-production.mjs` 会执行等价于以下形式的命令：

```bash
npx vercel deploy --prod \
  --build-env APP_VERSION=0.1.1 \
  --build-env APP_GIT_SHA=8b9f8f2 \
  --build-env "APP_GIT_MESSAGE=feat: add release metadata"
```

远端 `npm run build` 收到显式 `APP_VERSION` 后不会再次递增。Vercel CLI 成功退出后，本地包装器才更新 manifest。

直接运行 `vercel deploy --prod` 仍能完成远端构建，但远端文件系统是临时的，版本变化不会回写本地或 Git。

## 其他 CI/CD 平台

在 CI 中生成标准变量后执行原有构建命令：

```bash
APP_VERSION="$(node -p "require('./package.json').version")" \
APP_GIT_SHA="$(git rev-parse --short HEAD)" \
APP_GIT_MESSAGE="$(git log -1 --pretty=%s)" \
npm run build
```

显式提供 `APP_VERSION` 时，构建脚本不会写回 manifest。这适合不可变或临时 CI 工作区，也避免 CI 构建制造未提交文件。

如果 CI checkout 不含 `.git`，应使用平台提供的 commit 变量填充 `APP_GIT_SHA` 和 `APP_GIT_MESSAGE`。

## 常见问题

### `Unexpected token` 或 `Unexpected string`

先检查：

```bash
command -v node
node --version
```

这通常表示 npm script 命中了过旧的系统 Node.js。应通过 mise、nvm、Volta 或 CI 配置让现代 Node.js 位于 `PATH` 前部，不要在项目脚本中硬编码个人机器的 Node 路径。

### 新 commit 后开发页面仍显示旧 SHA

`npm run dev` 启动时读取一次 Git 信息。提交后重启开发服务器。

### `APP_GIT_MESSAGE` 显示 `unknown`

当前目录既没有可用 `.git`，环境中也没有显式 `APP_GIT_MESSAGE` 或 `VERCEL_GIT_COMMIT_MESSAGE`。在 CI 中传入标准 `APP_*` 变量。

### build 成功但版本没有写回

检查构建环境是否已经设置 `APP_VERSION`。显式版本表示“只消费、不持久化”，用于避免部署包装器和远端构建双增。

### 直接 Vercel 部署后本地版本没有变化

这是预期行为。直接 `vercel deploy --prod` 的版本修改只发生在远端临时目录；需要本地持久化时使用 `npm run prd`。

### `Invalid package-lock.json root package`

当前持久化逻辑要求 npm lockfile 含有 `packages[""]` 根包条目。确认已提交有效的 `package-lock.json`；pnpm 或 Yarn 项目必须提供对应适配，不能忽略该错误继续写入。

## 验证建议

迁移到新项目后至少执行：

```bash
npm run dev -- --help
npm test
npm run build
```

`npm run build` 成功后会更新版本文件；在试验性迁移中应预期并检查这项 diff。

确认：

- `dev` 不修改版本文件。
- 成功 build 后三个版本字段同步递增一次。
- 客户端页面显示的版本、SHA 和 commit 标题与构建输入一致。
- 失败 build 或 deploy 不修改版本。
- 不实际测试生产部署时，可使用伪造的 `npx` 或测试入口捕获 `--build-env` 参数。
