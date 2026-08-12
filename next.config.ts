import type { NextConfig } from "next"
import { readFileSync } from "node:fs"
import path from "node:path"

const pkg = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
)

const nextConfig: NextConfig = {
  allowedDevOrigins: ["0.0.0.0"],
  // 框架层只负责内联标准变量；版本与 Git 元数据的解析统一留在 scripts 中。
  env: {
    APP_VERSION: process.env.APP_VERSION ?? pkg.version,
    APP_GIT_SHA: process.env.APP_GIT_SHA ?? "unknown",
    APP_GIT_MESSAGE: process.env.APP_GIT_MESSAGE ?? "unknown",
  },
}

export default nextConfig
