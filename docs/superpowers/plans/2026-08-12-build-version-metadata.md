# Build Version Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `dev`、本地构建和 Vercel 生产部署统一生成 `APP_VERSION`、`APP_GIT_SHA`、`APP_GIT_MESSAGE`，并仅在成功构建或部署后持久化 patch 版本。

**Architecture:** 使用一个纯 Node.js ESM 模块处理版本、Git 元数据、manifest 更新和子进程执行；三个薄入口分别包装开发、构建和生产部署。Next.js 配置只消费标准化后的 `APP_*` 环境变量，不再执行 Git 命令或了解 Vercel。

**Tech Stack:** Node.js ESM、Vitest、Next.js 16.2.9、Vercel CLI、npm lockfile v3

## Global Constraints

- `npm run dev` 不递增或写入版本文件。
- `npm run build` 和 `npm run prd` 只在子进程成功后更新 `package.json` 与 `package-lock.json`。
- 显式 `APP_*` 优先于本地 Git，本地 Git 优先于 Vercel CI 输入，最终回退为 `unknown`。
- 不修改 `.env`、Vercel 项目配置或生产环境变量。
- 不增加第三方依赖，不自动暂存、commit、push、tag 或 release。
- 保留工作区现有 `APP_GIT_MESSAGE`、`prd` 和所有无关修改。

---

### Task 1: 通用版本与 Git 元数据模块

**Files:**
- Create: `scripts/app-metadata.mjs`
- Create: `scripts/app-metadata.test.ts`

**Interfaces:**
- Produces: `incrementPatchVersion(version: string): string`
- Produces: `readPackageVersion(cwd?: string): string`
- Produces: `resolveAppMetadata(options): { APP_VERSION: string, APP_GIT_SHA: string, APP_GIT_MESSAGE: string }`
- Produces: `persistPackageVersion(version: string, cwd?: string): void`
- Produces: `runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): number`

- [x] **Step 1: 写版本和元数据优先级的失败测试**

在 `scripts/app-metadata.test.ts` 使用 Vitest 覆盖：

```js
expect(incrementPatchVersion("0.1.0")).toBe("0.1.1")
expect(() => incrementPatchVersion("1.0")).toThrow("Invalid package version")

expect(resolveAppMetadata({
  version: "1.2.3",
  env: { APP_GIT_SHA: "explicit", APP_GIT_MESSAGE: "explicit message" },
  readGit: () => ({ sha: "local", message: "local message" }),
})).toEqual({
  APP_VERSION: "1.2.3",
  APP_GIT_SHA: "explicit",
  APP_GIT_MESSAGE: "explicit message",
})
```

再分别断言本地 Git、`VERCEL_GIT_COMMIT_SHA/MESSAGE` 和 `unknown` 的回退顺序。

- [x] **Step 2: 运行定向测试并确认失败**

Run: `npx vitest run scripts/app-metadata.test.ts`

Expected: FAIL，原因是 `scripts/app-metadata.mjs` 尚不存在。

- [x] **Step 3: 实现最小元数据模块**

实现严格三段式数字 SemVer patch 递增；使用 `execFileSync("git", ...)` 分别读取短 SHA 和最新提交标题，并允许测试注入 `readGit`。解析规则必须是：显式 `APP_*` → 本地 Git 非空值 → `VERCEL_*` → `unknown`。

`runCommand` 使用参数数组和 `spawnSync`，设置 `stdio: "inherit"`、继承并扩展环境，不通过 shell 拼接命令。

- [x] **Step 4: 写 manifest 同步测试并确认失败**

在 `mkdtempSync` 创建的 fixture 中写入最小 `package.json` 和 lockfile v3，调用：

```js
persistPackageVersion("0.1.1", fixtureDir)
```

断言 `package.json.version`、`package-lock.json.version`、`package-lock.json.packages[""].version` 全部变为 `0.1.1`；缺失 `packages[""]` 时抛错且不应先改写 `package.json`。

- [x] **Step 5: 实现 manifest 校验与同步写入**

先读取并校验两个 JSON 和 lockfile 根结构，再生成两份完整 JSON 文本，最后按项目现有两空格缩进和末尾换行写回。不得修改其他字段。

- [x] **Step 6: 运行定向测试**

Run: `npx vitest run scripts/app-metadata.test.ts`

Expected: PASS。

---

### Task 2: 开发、构建和生产部署入口

**Files:**
- Create: `scripts/run-with-app-metadata.mjs`
- Create: `scripts/build-with-version.mjs`
- Create: `scripts/deploy-production.mjs`
- Create: `scripts/commands.test.ts`
- Modify: `package.json`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: Task 1 导出的五个函数。
- Produces: `npm run dev`、`npm run build`、`npm run prd` 三条稳定命令。
- Produces: Next.js 客户端可访问的三个 `APP_*` 常量。

- [x] **Step 1: 写命令行为的失败集成测试**

测试通过临时目录和临时 `PATH` 中的伪可执行文件捕获参数及环境：

- 开发入口向子进程传入当前版本和三个 `APP_*`，不修改 manifest。
- 构建入口成功时使用下一 patch 版本并同步两个 manifest。
- 构建入口失败时保留退出码且不修改 manifest。
- 显式提供 `APP_VERSION` 的构建不再次递增或持久化。
- 部署入口向 `npx vercel deploy --prod` 添加三组 `--build-env KEY=value`，成功后只递增一次。

- [x] **Step 2: 运行命令测试并确认失败**

Run: `npx vitest run scripts/commands.test.ts`

Expected: FAIL，原因是三个入口文件尚不存在。

- [x] **Step 3: 实现开发入口**

`run-with-app-metadata.mjs` 从参数数组读取待执行命令，使用当前 `package.json.version` 和 `resolveAppMetadata` 生成环境，运行子进程并透传退出码；没有命令参数时输出明确错误并返回非零状态。

- [x] **Step 4: 实现构建入口**

`build-with-version.mjs` 在没有显式 `APP_VERSION` 时计算下一 patch 版本，运行 `next build`，仅退出码为 `0` 时调用 `persistPackageVersion`。存在显式 `APP_VERSION` 时使用它构建且不写 manifest，防止 Vercel 包装部署双增。

- [x] **Step 5: 实现生产部署入口**

`deploy-production.mjs` 计算下一 patch 版本和 Git 元数据，通过参数数组执行：

```text
npx vercel deploy --prod
  --build-env APP_VERSION=<value>
  --build-env APP_GIT_SHA=<value>
  --build-env APP_GIT_MESSAGE=<value>
```

仅 Vercel CLI 成功退出后同步本地两个 manifest。

- [x] **Step 6: 接入 npm scripts 和 Next.js 薄注入层**

将 scripts 更新为：

```json
"dev": "node scripts/run-with-app-metadata.mjs next dev --port 6602",
"build": "node scripts/build-with-version.mjs",
"prd": "node scripts/deploy-production.mjs"
```

`next.config.ts` 删除 `node:child_process` 和 `getGitSha()`，只保留：

```ts
env: {
  APP_VERSION: process.env.APP_VERSION ?? pkg.version,
  APP_GIT_SHA: process.env.APP_GIT_SHA ?? "unknown",
  APP_GIT_MESSAGE: process.env.APP_GIT_MESSAGE ?? "unknown",
}
```

- [x] **Step 7: 运行定向测试和静态检查**

Run: `npx vitest run scripts/app-metadata.test.ts scripts/commands.test.ts`

Expected: PASS。

Run: `npm run lint`

Expected: PASS，或仅报告与本任务无关且可明确定位的既有错误。

- [x] **Step 8: 验证真实构建并控制版本副作用**

先记录当前版本，执行 `npm run build`，确认构建产物出现预期三个值且两个 manifest 同步递增一次。验证完成后保留成功构建产生的版本递增，因为这正是新命令的契约；不实际执行生产部署。

- [x] **Step 9: 最终验证**

Run: `npm test`

Expected: PASS。

Run: `git diff --check`

Expected: 无 whitespace 错误。检查 `git diff`，确保没有覆盖现有 `APP_GIT_MESSAGE`、`prd` 和无关改动。

本任务未获得 commit 授权，因此不执行 `git add` 或 `git commit`。
