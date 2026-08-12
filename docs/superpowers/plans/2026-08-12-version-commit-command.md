# Version Commit Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个只更新 npm manifest 版本并安全创建本地 release commit 的独立命令，支持 `patch`、`minor`、`major`，默认 `patch`。

**Architecture:** 将现有 patch 专用版本函数扩展为通用 release type 计算函数，现有 build/deploy 继续显式使用 patch。新增薄入口负责检查两个 manifest 是否干净、同步版本，并用 `git commit --only` 创建仅包含目标文件的 release commit；所有真实 Git 行为只在临时测试仓库验证。

**Tech Stack:** Node.js ESM、Git CLI、Vitest、npm lockfile v3

## Global Constraints

- 命令为 `npm run version:commit -- [patch|minor|major]`，省略参数默认 `patch`。
- 只提交 `package.json` 和 `package-lock.json`，允许其他文件已暂存或未暂存。
- 两个目标 manifest 在工作区或暂存区已有修改时拒绝执行。
- commit message 固定为 `chore(release): vX.Y.Z`。
- commit 或 hook 失败时保留版本文件修改，不自动回滚。
- 不执行 build、deploy、tag、push、工作区清理或历史改写。
- 不在当前真实仓库运行 release 命令，不处理当前已有的 `0.1.2` manifest 修改。

---

### Task 1: 通用版本计算

**Files:**
- Modify: `scripts/app-metadata.mjs:37-40`
- Modify: `scripts/app-metadata.test.ts:37-51`
- Modify: `scripts/build-with-version.mjs:1-11`
- Modify: `scripts/deploy-production.mjs:1-11`

**Interfaces:**
- Produces: `incrementVersion(version: string, releaseType?: "patch" | "minor" | "major"): string`
- Removes: `incrementPatchVersion(version: string): string`
- Existing build/deploy entries consume `incrementVersion(currentVersion, "patch")`.

- [x] **Step 1: 写版本策略失败测试**

将 patch 专用测试改为：

```ts
expect(incrementVersion("1.2.3")).toBe("1.2.4")
expect(incrementVersion("1.2.3", "patch")).toBe("1.2.4")
expect(incrementVersion("1.2.3", "minor")).toBe("1.3.0")
expect(incrementVersion("1.2.3", "major")).toBe("2.0.0")
expect(() => incrementVersion("1.2.3", "invalid")).toThrow(
  "Invalid release type",
)
```

保留非严格三段式版本的错误测试。

- [x] **Step 2: 运行定向测试确认 RED**

Run: `node node_modules/vitest/vitest.mjs run scripts/app-metadata.test.ts`

Expected: FAIL，因为 `incrementVersion` 尚未导出。

- [x] **Step 3: 实现最小版本计算并更新调用方**

`incrementVersion` 先复用 `requireVersion()` 解析三个数字，再按 release type 返回：

```text
patch → major.minor.(patch + 1)
minor → major.(minor + 1).0
major → (major + 1).0.0
```

非法 release type 抛出 `Invalid release type: <value>`。删除旧函数，build/deploy 显式传入 `"patch"`。

- [x] **Step 4: 运行元数据和既有命令测试确认 GREEN**

Run: `node node_modules/vitest/vitest.mjs run scripts/app-metadata.test.ts scripts/commands.test.ts`

Expected: PASS。

---

### Task 2: 安全版本提交入口

**Files:**
- Create: `scripts/version-commit.mjs`
- Create: `scripts/version-commit.test.ts`
- Modify: `package.json:5-18`

**Interfaces:**
- Consumes: `incrementVersion`、`readPackageVersion`、`persistPackageVersion`、`runCommand`。
- Produces: `npm run version:commit -- [patch|minor|major]`。
- Produces: local commit `chore(release): vX.Y.Z` containing only `package.json` and `package-lock.json`。

- [x] **Step 1: 写临时 Git 仓库集成测试**

每个测试用 `mkdtempSync` 创建独立仓库，写入最小 npm manifests 和一个无关文件，然后执行：

```bash
git init -q
git config user.name "Version Test"
git config user.email "version-test@example.invalid"
git add package.json package-lock.json unrelated.txt
git commit -q -m "initial"
```

测试以下行为：

- 无参数默认生成 `0.1.1` 和 `chore(release): v0.1.1`。
- `minor` 生成 `0.2.0`，`major` 生成 `1.0.0`。
- release commit 只包含两个 manifest。
- 其他已暂存文件不进入 release commit，命令完成后仍保持暂存。
- 目标 manifest 已修改或已暂存时拒绝执行且不进一步修改。
- 非法 release type 拒绝执行且不修改文件。
- pre-commit hook 返回非零时不创建 commit，但保留递增后的 manifest 修改。

- [x] **Step 2: 运行集成测试确认 RED**

Run: `node node_modules/vitest/vitest.mjs run scripts/version-commit.test.ts`

Expected: FAIL，因为 `scripts/version-commit.mjs` 尚不存在。

- [x] **Step 3: 实现安全入口**

入口使用 Git 参数数组而不是 shell 字符串：

```text
git rev-parse --is-inside-work-tree
git status --porcelain=v1 -- package.json package-lock.json
git commit --only -m "chore(release): vX.Y.Z" -- package.json package-lock.json
```

状态输出非空时打印明确错误并返回非零状态。只接受零个或一个 release type 参数；额外参数也返回非零状态。版本写入后不捕获并回滚 commit 失败。

- [x] **Step 4: 添加 npm script 并测试项目接入**

在 `package.json` 添加：

```json
"version:commit": "node scripts/version-commit.mjs"
```

在集成测试中读取真实项目 `package.json` 并断言该入口存在；只读取当前 manifest，不运行命令。

- [x] **Step 5: 运行集成测试确认 GREEN**

Run: `node node_modules/vitest/vitest.mjs run scripts/version-commit.test.ts scripts/commands.test.ts`

Expected: PASS。

---

### Task 3: 支持文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/build-version-metadata.md`

**Interfaces:**
- Documents: 命令语法、Git 安全边界、失败语义和当前已有 manifest 修改会阻止命令运行。

- [x] **Step 1: 更新使用说明**

README 增加命令入口：

```bash
npm run version:commit
npm run version:commit -- minor
npm run version:commit -- major
```

支持文档说明默认 patch、只提交两个 manifest、目标文件必须干净、其他暂存内容保持不变、hook 失败保留文件修改，以及不自动 tag/push。

- [x] **Step 2: 运行格式和任务文件 lint**

Run: `node node_modules/prettier/bin/prettier.cjs --check README.md docs/build-version-metadata.md docs/superpowers/specs/2026-08-12-version-commit-command-design.md docs/superpowers/plans/2026-08-12-version-commit-command.md`

Expected: PASS。

Run: `node node_modules/eslint/bin/eslint.js scripts/app-metadata.mjs scripts/app-metadata.test.ts scripts/build-with-version.mjs scripts/deploy-production.mjs scripts/version-commit.mjs scripts/version-commit.test.ts scripts/commands.test.ts`

Expected: PASS。

- [x] **Step 3: 运行完整回归验证**

Run: `npm test`

Expected: 全部测试通过。

Run: `git diff --check`

Expected: 无 whitespace 错误。

检查 `git status --short` 和目标 diff，确认真实仓库没有新增 commit、没有暂存文件，原有 `0.1.2` 修改以及 `env.prd`、`mise.toml` 均保持用户状态。

本任务不执行 `git add`、真实 `version:commit` 或 `git commit`。
