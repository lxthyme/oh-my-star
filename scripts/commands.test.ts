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
import { afterEach, describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, "..")
const originalAppEnv = {
  APP_VERSION: process.env.APP_VERSION,
  APP_GIT_SHA: process.env.APP_GIT_SHA,
  APP_GIT_MESSAGE: process.env.APP_GIT_MESSAGE,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalAppEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

function createProject() {
  const cwd = mkdtempSync(path.join(tmpdir(), "app-commands-"))
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
        packages: { "": { name: "fixture", version: "0.1.0" } },
      },
      null,
      2,
    )}\n`,
  )
  return cwd
}

function installCaptureCommand(cwd, name) {
  const binDir = path.join(cwd, "bin")
  const commandPath = path.join(binDir, name)
  mkdirSync(binDir)

  writeFileSync(
    commandPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args: process.argv.slice(2),
  metadata: {
    APP_VERSION: process.env.APP_VERSION,
    APP_GIT_SHA: process.env.APP_GIT_SHA,
    APP_GIT_MESSAGE: process.env.APP_GIT_MESSAGE,
  },
}))
process.exit(Number(process.env.FAKE_EXIT_CODE ?? 0))
`,
  )
  chmodSync(commandPath, 0o755)
  return binDir
}

function commandEnv(cwd, binDir, extra = {}) {
  const env = {
    ...process.env,
    PATH: `${binDir}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    CAPTURE_PATH: path.join(cwd, "capture.json"),
    APP_GIT_SHA: "local-sha",
    APP_GIT_MESSAGE: "ship feature",
    ...extra,
  }
  delete env.APP_VERSION
  delete env.VERCEL_GIT_COMMIT_SHA
  delete env.VERCEL_GIT_COMMIT_MESSAGE
  if (extra.APP_VERSION) env.APP_VERSION = extra.APP_VERSION
  return env
}

function runEntry(cwd, fileName, args, env) {
  return spawnSync(process.execPath, [path.join(scriptsDir, fileName), ...args], {
    cwd,
    env,
    encoding: "utf8",
  })
}

function readCapture(cwd) {
  return JSON.parse(readFileSync(path.join(cwd, "capture.json"), "utf8"))
}

function readVersions(cwd) {
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
  const lock = JSON.parse(
    readFileSync(path.join(cwd, "package-lock.json"), "utf8"),
  )
  return [pkg.version, lock.version, lock.packages[""].version]
}

describe("run-with-app-metadata", () => {
  it("injects current metadata without changing the version", () => {
    const cwd = createProject()
    const binDir = installCaptureCommand(cwd, "capture-command")
    const result = runEntry(
      cwd,
      "run-with-app-metadata.mjs",
      ["capture-command", "dev-argument"],
      commandEnv(cwd, binDir),
    )

    expect(result.status).toBe(0)
    expect(readCapture(cwd)).toEqual({
      args: ["dev-argument"],
      metadata: {
        APP_VERSION: "0.1.0",
        APP_GIT_SHA: "local-sha",
        APP_GIT_MESSAGE: "ship feature",
      },
    })
    expect(readVersions(cwd)).toEqual(["0.1.0", "0.1.0", "0.1.0"])
  })
})

describe("build-with-version", () => {
  it("persists the next patch after a successful build", () => {
    const cwd = createProject()
    const binDir = installCaptureCommand(cwd, "next")
    const result = runEntry(
      cwd,
      "build-with-version.mjs",
      [],
      commandEnv(cwd, binDir),
    )

    expect(result.status).toBe(0)
    expect(readCapture(cwd)).toEqual({
      args: ["build"],
      metadata: {
        APP_VERSION: "0.1.1",
        APP_GIT_SHA: "local-sha",
        APP_GIT_MESSAGE: "ship feature",
      },
    })
    expect(readVersions(cwd)).toEqual(["0.1.1", "0.1.1", "0.1.1"])
  })

  it("does not persist a version after a failed build", () => {
    const cwd = createProject()
    const binDir = installCaptureCommand(cwd, "next")
    const result = runEntry(
      cwd,
      "build-with-version.mjs",
      [],
      commandEnv(cwd, binDir, { FAKE_EXIT_CODE: "9" }),
    )

    expect(result.status).toBe(9)
    expect(readVersions(cwd)).toEqual(["0.1.0", "0.1.0", "0.1.0"])
  })

  it("uses an explicit version without persisting it", () => {
    const cwd = createProject()
    const binDir = installCaptureCommand(cwd, "next")
    const result = runEntry(
      cwd,
      "build-with-version.mjs",
      [],
      commandEnv(cwd, binDir, { APP_VERSION: "7.8.9" }),
    )

    expect(result.status).toBe(0)
    expect(readCapture(cwd).metadata.APP_VERSION).toBe("7.8.9")
    expect(readVersions(cwd)).toEqual(["0.1.0", "0.1.0", "0.1.0"])
  })
})

describe("deploy-production", () => {
  it("passes one version and Git metadata to Vercel before persisting", () => {
    const cwd = createProject()
    const binDir = installCaptureCommand(cwd, "npx")
    const result = runEntry(
      cwd,
      "deploy-production.mjs",
      [],
      commandEnv(cwd, binDir),
    )

    expect(result.status).toBe(0)
    expect(readCapture(cwd).args).toEqual([
      "vercel",
      "deploy",
      "--prod",
      "--build-env",
      "APP_VERSION=0.1.1",
      "--build-env",
      "APP_GIT_SHA=local-sha",
      "--build-env",
      "APP_GIT_MESSAGE=ship feature",
    ])
    expect(readVersions(cwd)).toEqual(["0.1.1", "0.1.1", "0.1.1"])
  })
})

describe("project integration", () => {
  it("routes npm commands through the metadata entry points", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    )
    expect(pkg.scripts.dev).toBe(
      "node scripts/run-with-app-metadata.mjs next dev --port 6602",
    )
    expect(pkg.scripts.build).toBe("node scripts/build-with-version.mjs")
    expect(pkg.scripts.prd).toBe("node scripts/deploy-production.mjs")
  })

  it("exposes only standardized APP metadata through Next.js", async () => {
    process.env.APP_VERSION = "3.2.1"
    process.env.APP_GIT_SHA = "standard-sha"
    process.env.APP_GIT_MESSAGE = "standard message"
    const { default: config } = await import("../next.config.ts")

    expect(config.env).toEqual({
      APP_VERSION: "3.2.1",
      APP_GIT_SHA: "standard-sha",
      APP_GIT_MESSAGE: "standard message",
    })
  })
})
