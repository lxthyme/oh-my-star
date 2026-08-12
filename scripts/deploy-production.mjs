import {
  incrementPatchVersion,
  persistPackageVersion,
  readPackageVersion,
  resolveAppMetadata,
  runCommand,
} from "./app-metadata.mjs"

const explicitVersion = process.env.APP_VERSION?.trim()
const version = explicitVersion ?? incrementPatchVersion(readPackageVersion())
const metadata = resolveAppMetadata({ version })
// 显式传给远端 build 后，它只消费该版本；部署成功再由本地包装器持久化一次。
const buildEnvArgs = Object.entries(metadata).flatMap(([key, value]) => [
  "--build-env",
  `${key}=${value}`,
])
const status = runCommand(
  "npx",
  ["vercel", "deploy", "--prod", ...buildEnvArgs],
  process.env,
)

if (status === 0 && !explicitVersion) {
  // 失败部署不更新本地 manifest，避免本地版本领先于实际生产部署。
  persistPackageVersion(version)
}

process.exitCode = status
