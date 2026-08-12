import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, "..")
const entryPath = path.join(scriptsDir, "version-commit.mjs")

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function writeManifests(cwd: string, version = "0.1.0") {
  writeFileSync(
    path.join(cwd, "package.json"),
    `${JSON.stringify({ name: "fixture", version }, null, 2)}\n`,
  )
  writeFileSync(
    path.join(cwd, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        version,
        lockfileVersion: 3,
        packages: { "": { name: "fixture", version } },
      },
      null,
      2,
    )}\n`,
  )
}

function createRepository() {
  const cwd = mkdtempSync(path.join(tmpdir(), "version-commit-"))
  writeManifests(cwd)
  writeFileSync(path.join(cwd, "unrelated.txt"), "initial\n")
  git(cwd, ["init", "-q"])
  git(cwd, ["config", "user.name", "Version Test"])
  git(cwd, ["config", "user.email", "version-test@example.invalid"])
  git(cwd, ["config", "core.hooksPath", path.join(cwd, ".git/hooks")])
  git(cwd, ["add", "package.json", "package-lock.json", "unrelated.txt"])
  git(cwd, ["commit", "-q", "-m", "initial"])
  return cwd
}

function runEntry(cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, [entryPath, ...args], {
    cwd,
    env: process.env,
    encoding: "utf8",
  })
}

function readVersions(cwd: string) {
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
  const lock = JSON.parse(
    readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
  )
  return [pkg.version, lock.version, lock.packages[""].version]
}

function committedFiles(cwd: string) {
  return git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    .split("\n")
    .filter(Boolean)
    .sort()
}

describe("version-commit", () => {
  it("defaults to patch and commits only the npm manifests", () => {
    const cwd = createRepository()
    const result = runEntry(cwd)

    expect(result.status).toBe(0)
    expect(readVersions(cwd)).toEqual(["0.1.1", "0.1.1", "0.1.1"])
    expect(git(cwd, ["log", "-1", "--pretty=%s"])).toBe(
      "chore(release): v0.1.1",
    )
    expect(committedFiles(cwd)).toEqual(["package-lock.json", "package.json"])
  })

  it.each([
    ["minor", "0.2.0"],
    ["major", "1.0.0"],
  ])("supports the %s release type", (releaseType, expectedVersion) => {
    const cwd = createRepository()
    const result = runEntry(cwd, [releaseType])

    expect(result.status).toBe(0)
    expect(readVersions(cwd)).toEqual([
      expectedVersion,
      expectedVersion,
      expectedVersion,
    ])
  })

  it("preserves unrelated staged changes outside the release commit", () => {
    const cwd = createRepository()
    writeFileSync(path.join(cwd, "unrelated.txt"), "staged change\n")
    git(cwd, ["add", "unrelated.txt"])

    const result = runEntry(cwd)

    expect(result.status).toBe(0)
    expect(committedFiles(cwd)).toEqual(["package-lock.json", "package.json"])
    expect(git(cwd, ["diff", "--cached", "--name-only"])).toBe("unrelated.txt")
  })

  it("rejects an existing unstaged manifest change without modifying it", () => {
    const cwd = createRepository()
    writeManifests(cwd, "0.1.7")
    const before = readFileSync(path.join(cwd, "package.json"), "utf8")

    const result = runEntry(cwd)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Release manifests must be clean")
    expect(readFileSync(path.join(cwd, "package.json"), "utf8")).toBe(before)
    expect(git(cwd, ["log", "-1", "--pretty=%s"])).toBe("initial")
  })

  it("rejects an existing staged manifest change", () => {
    const cwd = createRepository()
    writeManifests(cwd, "0.1.7")
    git(cwd, ["add", "package.json", "package-lock.json"])

    const result = runEntry(cwd)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Release manifests must be clean")
    expect(readVersions(cwd)).toEqual(["0.1.7", "0.1.7", "0.1.7"])
    expect(git(cwd, ["log", "-1", "--pretty=%s"])).toBe("initial")
  })

  it("rejects unsupported or extra arguments without modifying manifests", () => {
    for (const args of [["invalid"], ["patch", "extra"]]) {
      const cwd = createRepository()
      const result = runEntry(cwd, args)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("Usage: version-commit")
      expect(readVersions(cwd)).toEqual(["0.1.0", "0.1.0", "0.1.0"])
      expect(git(cwd, ["log", "-1", "--pretty=%s"])).toBe("initial")
    }
  })

  it("keeps the incremented manifests when a commit hook fails", () => {
    const cwd = createRepository()
    const hookPath = path.join(cwd, ".git/hooks/pre-commit")
    mkdirSync(path.dirname(hookPath), { recursive: true })
    writeFileSync(hookPath, "#!/bin/sh\nexit 17\n")
    chmodSync(hookPath, 0o755)

    const result = runEntry(cwd)

    expect(result.status).not.toBe(0)
    expect(readVersions(cwd)).toEqual(["0.1.1", "0.1.1", "0.1.1"])
    expect(git(cwd, ["log", "-1", "--pretty=%s"])).toBe("initial")
  })

  it("is exposed through the project npm scripts", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    )
    expect(pkg.scripts["version:commit"]).toBe(
      "node scripts/version-commit.mjs",
    )
  })
})
