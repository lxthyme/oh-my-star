import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  incrementVersion,
  persistPackageVersion,
  readPackageVersion,
  resolveAppMetadata,
  runCommand,
} from "./app-metadata.mjs"

function createManifestFixture({ validLockfile = true } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "app-metadata-"))
  writeFileSync(
    path.join(cwd, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "0.1.0" }, null, 2)}\n`,
  )
  writeFileSync(
    path.join(cwd, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        version: "0.1.0",
        lockfileVersion: 3,
        packages: validLockfile
          ? { "": { name: "fixture", version: "0.1.0" } }
          : {},
      },
      null,
      2,
    )}\n`,
  )
  return cwd
}

describe("incrementVersion", () => {
  it("increments the selected release component", () => {
    expect(incrementVersion("1.2.3")).toBe("1.2.4")
    expect(incrementVersion("1.2.3", "patch")).toBe("1.2.4")
    expect(incrementVersion("1.2.3", "minor")).toBe("1.3.0")
    expect(incrementVersion("1.2.3", "major")).toBe("2.0.0")
  })

  it("rejects unsupported release types", () => {
    expect(() => incrementVersion("1.2.3", "invalid")).toThrow(
      "Invalid release type",
    )
  })

  it("rejects versions outside strict three-part SemVer", () => {
    expect(() => incrementVersion("1.0")).toThrow("Invalid package version")
    expect(() => incrementVersion("1.0.0-beta.1")).toThrow(
      "Invalid package version",
    )
  })
})

describe("resolveAppMetadata", () => {
  it("prefers explicit APP values", () => {
    expect(
      resolveAppMetadata({
        version: "1.2.3",
        env: {
          APP_VERSION: "4.5.6",
          APP_GIT_SHA: "explicit",
          APP_GIT_MESSAGE: "explicit message",
          VERCEL_GIT_COMMIT_SHA: "vercel",
          VERCEL_GIT_COMMIT_MESSAGE: "vercel message",
        },
        readGit: () => ({ sha: "local", message: "local message" }),
      }),
    ).toEqual({
      APP_VERSION: "4.5.6",
      APP_GIT_SHA: "explicit",
      APP_GIT_MESSAGE: "explicit message",
    })
  })

  it("prefers local Git values over Vercel values", () => {
    expect(
      resolveAppMetadata({
        version: "1.2.3",
        env: {
          VERCEL_GIT_COMMIT_SHA: "vercel",
          VERCEL_GIT_COMMIT_MESSAGE: "vercel message",
        },
        readGit: () => ({ sha: "local", message: "local message" }),
      }),
    ).toEqual({
      APP_VERSION: "1.2.3",
      APP_GIT_SHA: "local",
      APP_GIT_MESSAGE: "local message",
    })
  })

  it("falls back to Vercel values and then unknown", () => {
    expect(
      resolveAppMetadata({
        version: "1.2.3",
        env: {
          VERCEL_GIT_COMMIT_SHA: "vercel",
          VERCEL_GIT_COMMIT_MESSAGE: "vercel message",
        },
        readGit: () => ({ sha: undefined, message: undefined }),
      }),
    ).toEqual({
      APP_VERSION: "1.2.3",
      APP_GIT_SHA: "vercel",
      APP_GIT_MESSAGE: "vercel message",
    })

    expect(
      resolveAppMetadata({
        version: "1.2.3",
        env: {},
        readGit: () => ({ sha: undefined, message: undefined }),
      }),
    ).toEqual({
      APP_VERSION: "1.2.3",
      APP_GIT_SHA: "unknown",
      APP_GIT_MESSAGE: "unknown",
    })
  })
})

describe("package manifests", () => {
  it("reads package.json version", () => {
    const cwd = createManifestFixture()
    expect(readPackageVersion(cwd)).toBe("0.1.0")
  })

  it("updates package.json and the lockfile root together", () => {
    const cwd = createManifestFixture()
    persistPackageVersion("0.1.1", cwd)

    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
    const lock = JSON.parse(
      readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
    )
    expect(pkg.version).toBe("0.1.1")
    expect(lock.version).toBe("0.1.1")
    expect(lock.packages[""].version).toBe("0.1.1")
  })

  it("validates the lockfile before changing package.json", () => {
    const cwd = createManifestFixture({ validLockfile: false })
    const before = readFileSync(path.join(cwd, "package.json"), "utf8")

    expect(() => persistPackageVersion("0.1.1", cwd)).toThrow(
      "Invalid package-lock.json root package",
    )
    expect(readFileSync(path.join(cwd, "package.json"), "utf8")).toBe(before)
  })
})

describe("runCommand", () => {
  it("returns the child process exit status", () => {
    expect(
      runCommand(process.execPath, ["-e", "process.exit(7)"], process.env),
    ).toBe(7)
  })
})
