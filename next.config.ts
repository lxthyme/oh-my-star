import type { NextConfig } from "next"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

// 构建时读取 package.json 版本号(唯一真相源是 git tag,但 version 字段会跟随 tag)
const pkg = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
)

function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim()
  } catch {
    return "unknown"
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["0.0.0.0"],
  env: {
    // 优先用环境变量覆盖(适配 CI/Docker),否则回退到 package.json
    APP_VERSION: process.env.APP_VERSION ?? pkg.version,
    // 优先用 CI 提供的 sha(Vercel/其他),否则本地 git 读取
    APP_GIT_SHA:
      process.env.APP_GIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      getGitSha(),
  },
}

export default nextConfig
