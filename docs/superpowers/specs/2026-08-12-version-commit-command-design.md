# 独立版本提交命令 — 设计文档

- 日期：2026-08-12
- 状态：方案已确认，待文档复核

## 目标

新增独立命令 `npm run version:commit -- [patch|minor|major]`，只负责更新 npm manifest 版本并创建本地 release commit。省略参数时默认递增 patch。

该命令不参与 `dev`、`build` 或 `prd`，也不执行 build、deploy、tag、push 或其他远端操作。

## 命令行为

执行顺序固定为：

1. 确认当前目录位于 Git 工作区。
2. 校验 release type，只接受 `patch`、`minor`、`major`，默认 `patch`。
3. 同时检查 `package.json` 和 `package-lock.json` 的工作区及暂存区状态；任一文件已有修改时立即失败。
4. 从 `package.json.version` 计算新版本。
5. 使用现有 manifest 同步逻辑更新两个文件中的三个版本字段。
6. 仅提交 `package.json` 和 `package-lock.json`，commit message 为 `chore(release): vX.Y.Z`。
7. 透传 Git commit 的退出状态。

## Git 安全边界

- 只要求两个目标 manifest 在命令开始前干净，允许仓库存在其他已暂存或未暂存修改。
- 使用带 pathspec 的 `git commit --only`，其他暂存内容不进入 release commit，并保持原暂存状态。
- 不执行 `git add .`、`git commit -a` 或任何工作区清理命令。
- commit 或 hook 失败时保留已经生成的 manifest 修改，便于用户检查和重试；不自动回滚文件或 Git 状态。
- 当前工作区已有的 `0.1.1 → 0.1.2` manifest 修改属于用户内容。新命令不会处理或提交它们；首次实际运行会拒绝，直到用户自行提交或处理这两处既有修改。

## 版本规则

当前版本必须是严格三段式数字版本 `major.minor.patch`：

| 输入 | release type | 输出 |
| --- | --- | --- |
| `1.2.3` | `patch` | `1.2.4` |
| `1.2.3` | `minor` | `1.3.0` |
| `1.2.3` | `major` | `2.0.0` |

不支持预发布、build metadata、自定义完整版本或同时递增多个部分。

## 代码结构

- 将通用元数据模块中的 patch 专用函数扩展为按 release type 计算版本的单一函数；现有 build 入口显式传入 `patch`。
- 新增一个薄的版本提交入口，负责目标文件干净检查、调用版本更新和创建 commit。
- `package.json` 只新增 `version:commit` 命令，不改变现有 `dev`、`build`、`prd` 行为。

## 验证

- 单元测试覆盖 patch、minor、major 和非法 release type。
- 在临时 Git 仓库中验证默认 patch、显式 minor/major、commit message 与目标文件范围。
- 验证目标 manifest 已修改或已暂存时拒绝执行。
- 验证其他已暂存文件不会进入 release commit，且提交后仍保持暂存。
- 验证 commit 失败时版本文件保留修改并返回非零状态。
- 运行完整测试、任务文件 lint 和 `git diff --check`。
- 不在当前真实仓库执行该 release 命令。
