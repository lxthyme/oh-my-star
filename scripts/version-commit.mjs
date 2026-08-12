import { execFileSync } from "node:child_process"
import {
  incrementVersion,
  persistPackageVersion,
  readPackageVersion,
  runCommand,
} from "./app-metadata.mjs"

const RELEASE_TYPES = new Set(["patch", "minor", "major"])
const MANIFESTS = ["package.json", "package-lock.json"]
const USAGE = "Usage: version-commit [patch|minor|major]"

function gitOutput(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function main() {
  gitOutput(["rev-parse", "--is-inside-work-tree"])

  const args = process.argv.slice(2)
  const releaseType = args[0] ?? "patch"
  if (args.length > 1 || !RELEASE_TYPES.has(releaseType)) {
    console.error(USAGE)
    return 1
  }

  const manifestStatus = gitOutput([
    "status",
    "--porcelain=v1",
    "--",
    ...MANIFESTS,
  ])
  if (manifestStatus) {
    console.error(
      "Release manifests must be clean before creating a version commit",
    )
    return 1
  }

  const version = incrementVersion(readPackageVersion(), releaseType)
  persistPackageVersion(version)

  // --only 让 release commit 忽略其他已暂存内容，并保持它们留在暂存区。
  return runCommand(
    "git",
    [
      "commit",
      "--only",
      "-m",
      `chore(release): v${version}`,
      "--",
      ...MANIFESTS,
    ],
    process.env,
  )
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
