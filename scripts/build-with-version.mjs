import {
  incrementVersion,
  persistPackageVersion,
  readPackageVersion,
  resolveAppMetadata,
  runCommand,
} from "./app-metadata.mjs"

// 部署包装器会预先注入版本；远端 build 必须直接消费它，避免同一次部署再次自增。
const explicitVersion = process.env.APP_VERSION?.trim()
const version =
  explicitVersion ?? incrementVersion(readPackageVersion(), "patch")
const metadata = resolveAppMetadata({ version })
const status = runCommand("next", ["build"], {
  ...process.env,
  ...metadata,
})

if (status === 0 && !explicitVersion) {
  // 失败构建不消耗版本号，manifest 只记录实际成功产出的版本。
  persistPackageVersion(version)
}

process.exitCode = status
