import {
  readPackageVersion,
  resolveAppMetadata,
  runCommand,
} from "./app-metadata.mjs"

const [command, ...args] = process.argv.slice(2)

if (!command) {
  console.error("Missing command to run with app metadata")
  process.exitCode = 1
} else {
  // 开发命令只注入当前元数据，不递增或写入版本文件。
  const metadata = resolveAppMetadata({ version: readPackageVersion() })
  process.exitCode = runCommand(command, args, {
    ...process.env,
    ...metadata,
  })
}
