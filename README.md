# next-github-star

## 开发与构建

```bash
npm run dev
npm run build
npm run prd # 实际发布到 Vercel production
npm run version:commit # 默认递增 patch 并创建本地 release commit
```

`dev` 使用当前版本；`build` 和 `prd` 在成功后自动递增并同步 npm manifest 中的 patch 版本，但不会 commit。`version:commit` 是独立的本地提交命令，支持 `patch`、`minor`、`major`；所有命令都不会自动 tag 或 push。

Next.js、Vue + Vite、Vercel 和其他 CI/CD 平台的配置与排障说明见[构建版本元数据脚本使用指南](docs/build-version-metadata.md)。
