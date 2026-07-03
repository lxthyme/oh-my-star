# next-github-star


# 发布前
  npm version patch   # 0.1.0 → 0.1.1   (修 bug)
  npm version minor   # 0.1.0 → 0.2.0   (新功能)
  npm version major   # 0.1.0 → 1.0.0   (破坏性变更)
  # 该命令会自动:改 package.json + commit + 打 git tag

  # 推送到远端
  git push --follow-tags
