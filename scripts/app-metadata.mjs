import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const STRICT_VERSION = /^(\d+)\.(\d+)\.(\d+)$/

function requireVersion(version) {
  const match = STRICT_VERSION.exec(version)
  if (!match) {
    throw new Error(`Invalid package version: ${version}`)
  }
  return match
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function readGitValue(args, cwd) {
  try {
    return nonEmpty(
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )
  } catch {
    return undefined
  }
}

export function incrementVersion(version, releaseType = "patch") {
  const [, major, minor, patch] = requireVersion(version)
  switch (releaseType) {
    case "patch":
      return `${major}.${minor}.${Number(patch) + 1}`
    case "minor":
      return `${major}.${Number(minor) + 1}.0`
    case "major":
      return `${Number(major) + 1}.0.0`
    default:
      throw new Error(`Invalid release type: ${releaseType}`)
  }
}

export function readPackageVersion(cwd = process.cwd()) {
  const version = readJson(path.join(cwd, "package.json")).version
  requireVersion(version)
  return version
}

export function readGitMetadata(cwd = process.cwd()) {
  return {
    sha: readGitValue(["rev-parse", "--short", "HEAD"], cwd),
    message: readGitValue(["log", "-1", "--pretty=%s"], cwd),
  }
}

export function resolveAppMetadata({
  version,
  env = process.env,
  cwd = process.cwd(),
  readGit = readGitMetadata,
}) {
  const git = readGit(cwd)
  // 标准 APP_* 始终优先；本地 Git 让 dev/build 不依赖 CI，Vercel 只为无 .git 的远端构建兜底。
  return {
    APP_VERSION: nonEmpty(env.APP_VERSION) ?? version,
    APP_GIT_SHA:
      nonEmpty(env.APP_GIT_SHA) ??
      nonEmpty(git.sha) ??
      nonEmpty(env.VERCEL_GIT_COMMIT_SHA) ??
      "unknown",
    APP_GIT_MESSAGE:
      nonEmpty(env.APP_GIT_MESSAGE) ??
      nonEmpty(git.message) ??
      nonEmpty(env.VERCEL_GIT_COMMIT_MESSAGE) ??
      "unknown",
  }
}

export function persistPackageVersion(version, cwd = process.cwd()) {
  requireVersion(version)

  const packagePath = path.join(cwd, "package.json")
  const lockPath = path.join(cwd, "package-lock.json")
  const pkg = readJson(packagePath)
  const lock = readJson(lockPath)

  if (!lock.packages || !lock.packages[""]) {
    throw new Error("Invalid package-lock.json root package")
  }

  pkg.version = version
  lock.version = version
  lock.packages[""].version = version

  const packageContents = `${JSON.stringify(pkg, null, 2)}\n`
  const lockContents = `${JSON.stringify(lock, null, 2)}\n`
  // 先完整校验并生成两份内容，避免 lockfile 结构异常时只改到 package.json。
  writeFileSync(packagePath, packageContents)
  writeFileSync(lockPath, lockContents)
}

export function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  })
  if (result.error) {
    throw result.error
  }
  return result.status ?? 1
}
