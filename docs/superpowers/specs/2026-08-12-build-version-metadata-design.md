# 构建版本与 Git 元数据自动更新 — 设计文档

- 日期：2026-08-12
- 状态：已确认方案，待文档复核

## 背景

当前 `next.config.ts` 同时负责读取版本、解析 Git 元数据和向客户端注入变量，Vercel 变量也直接出现在框架配置中。`npm run dev` 没有 Vercel 系统变量，因此当前 `APP_GIT_MESSAGE` 在本地为 `undefined`，而 `package.json.version` 也不会自动递增。

本次把版本和 Git 信息统一收敛到一个不依赖 Web 框架的 Node.js 元数据模块。`dev`、本地构建和生产部署都通过脚本生成统一的 `APP_VERSION`、`APP_GIT_SHA`、`APP_GIT_MESSAGE`；Next.js 只负责将这三个变量注入客户端。构建版本按 patch 位递增，例如 `0.1.0` 递增为 `0.1.1`。

## 约束

- 构建失败或部署失败时，不持久化新版本，避免失败操作消耗版本号。
- 一次生产部署只递增一次，不允许本地包装命令与 Vercel 远端构建各递增一次。
- 不修改 `.env` 文件；`APP_VERSION` 和 `APP_GIT_SHA` 仅作为构建时环境变量注入。
- 同步维护 `package.json` 与 `package-lock.json` 中的根包版本。
- 不写回 Git、不自动暂存或提交，也不引入外部版本存储。
- 保留并纳入当前未提交的 `APP_GIT_MESSAGE` 和 `prd` 相关修改。
- 元数据核心不导入 Next.js 或 Vercel SDK，可以复制到其他 Node.js Web 项目使用。

## 命令行为

### `npm run dev`

通用命令包装入口读取当前 `package.json.version`，解析 Git SHA 和最新提交标题，并把三个 `APP_*` 变量注入 `next dev` 子进程。开发命令不递增或写入版本文件。

本地 Git 元数据优先于 CI 平台变量，因此重启开发服务后会反映当前 commit。正在运行的 `next dev` 不监听 Git 引用变化，新 commit 后需要重启开发服务。

### `npm run build`

构建包装脚本执行以下流程：

1. 如果外部没有提供 `APP_VERSION`，读取 `package.json.version` 并计算下一个 patch 版本。
2. 解析 Git SHA 和最新提交标题。
3. 使用计算出的三个 `APP_*` 变量启动 `next build`。
4. 构建成功且版本由脚本自动计算时，将新版本写入本地 `package.json` 和 `package-lock.json`。
5. 构建失败时原样返回失败状态，不更新版本文件。

如果调用方已经提供 `APP_VERSION`，包装脚本直接使用该版本且不再次递增。这是防止生产部署双增的边界。

### `npm run prd`

沿用当前已有的 `prd` 命令名，将它改为调用生产部署包装脚本：

1. 从本地 `package.json.version` 计算下一个 patch 版本，但暂不写文件。
2. 读取当前 Git SHA 和最新提交标题。
3. 执行 `npx vercel deploy --prod`，并通过 `--build-env` 传入三个 `APP_*` 变量。
4. Vercel 远端执行 `npm run build` 时检测到外部版本，只构建、不再次递增。
5. Vercel CLI 成功退出后，将新版本写入本地 `package.json` 和 `package-lock.json`；部署失败则不写入。

### 直接执行 `vercel deploy --prod`

直接命令仍会触发 Vercel 远端的 `npm run build`。远端脚本会基于上传的 `package.json.version` 计算下一版本；远端没有 `.git` 时，元数据模块使用 Vercel 提供的 commit SHA 和 message 作为 CI 输入适配，并统一转换成 `APP_*` 变量。

Vercel 构建目录是临时环境，因此远端对 `package.json` 的更新不会写回本地或 Git。同一源码需要连续持久化版本时，必须使用 `npm run prd`。

## 代码结构

新增一个通用元数据模块，集中负责以下职责：

- 解析并递增 SemVer patch 版本。
- 按统一优先级解析 Git SHA 和最新提交标题。
- 更新 `package.json` 和 `package-lock.json` 的根包版本。
- 以继承当前环境的方式启动子进程并透传退出状态。

新增三个很薄的命令入口：

- 开发入口：读取当前版本和 Git 元数据，执行 `next dev`，不写版本文件。
- 构建入口：计算元数据、执行 `next build`、成功后持久化版本。
- 生产部署入口：计算元数据、执行带 `--build-env` 的 Vercel CLI、成功后持久化版本。

Next.js 的 `next.config.ts` 只把已经标准化的三个 `APP_*` 值放入 `env`。它不执行 Git 命令，也不直接读取 Vercel 变量。

元数据解析优先级为：

```text
APP_VERSION → package.json.version
APP_GIT_SHA → 本地 Git → VERCEL_GIT_COMMIT_SHA → unknown
APP_GIT_MESSAGE → 本地 Git → VERCEL_GIT_COMMIT_MESSAGE → unknown
```

显式 `APP_*` 始终最高优先级。本地没有 `.git` 时才进入 CI 平台输入适配。其他 CI/CD 只需预先提供标准 `APP_*`，无需修改模块。

不增加第三方依赖，不引入通用任务框架，也不改变应用运行时的数据流。

## 错误处理

- `package.json.version` 不是有效的三段式 SemVer 时立即失败，不启动构建或部署。
- Git SHA 或提交标题无法读取且环境中没有可用 CI 值时使用 `unknown` 回退。
- `package-lock.json` 缺少预期的根包结构时立即失败，避免两个版本文件不一致。
- 子进程失败时保留其退出码，不写入版本文件。
- 文件更新采用先完整生成内容、再分别写入的局部操作；不回滚或覆盖任务范围外的工作区修改。

## 验收与验证

- 在临时 fixture 中验证 patch 递增以及两个版本文件同步更新。
- 验证显式传入 `APP_VERSION` 时不会再次递增。
- 验证 `dev` 使用当前版本、不写文件，并向子进程提供三个 `APP_*` 变量。
- 验证 Git 元数据优先级为显式 `APP_*`、本地 Git、Vercel CI 输入、`unknown`。
- 使用伪造的成功和失败子进程验证仅成功时持久化版本。
- 执行一次项目构建，确认客户端产物包含新版本、当前 Git SHA 和提交标题。
- 使用参数捕获验证 `npm run prd` 只生成一次版本，并向 Vercel CLI 传递三个 `--build-env` 参数；不实际发布生产部署作为自动化测试的一部分。
- 运行现有 lint、测试以及 `git diff --check`。

## 不在本次范围内

- 自动 commit、push、tag 或 release。
- Vercel 构建完成后向 Git 仓库写回版本。
- 跨机器共享的全局递增计数器。
- major、minor 或预发布版本策略。
- 修改 `.env`、Vercel 项目配置或生产环境变量。
- 为不同前端框架实现客户端注入适配；通用脚本只保证向子进程提供标准 `APP_*` 环境变量。
