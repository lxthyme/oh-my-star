"use client"

import { Alert, Button, Card, Flex, Typography } from "antd"
import { GithubOutlined } from "@ant-design/icons"

export default function LoginCard({
  error,
  action,
}: {
  error?: string
  action: () => Promise<void>
}) {
  return (
    <Flex justify="center" style={{ paddingTop: 96 }}>
      <Card style={{ width: 360, textAlign: "center" }}>
        <Typography.Title level={4}>登录</Typography.Title>
        <Typography.Paragraph type="secondary">
          仅限授权的 GitHub 账号访问
        </Typography.Paragraph>
        {error && (
          <Typography.Paragraph type="danger">
            登录失败：该 GitHub 账号未被授权
          </Typography.Paragraph>
        )}
        <Alert
          type="info"
          showIcon
          message="已升级权限范围"
          description={
            <Typography.Paragraph style={{ margin: 0, fontSize: 13 }}>
              本次登录新增了 <code>repo</code> 权限，用于同步私有仓库。
              请先在 GitHub
              <a
                href="https://github.com/settings/applications"
                target="_blank"
                rel="noreferrer"
              >
                撤销旧授权
              </a>
              ，或直接点击下方按钮重新登录以重新授权。
            </Typography.Paragraph>
          }
          style={{ textAlign: "left", marginBottom: 16 }}
        />
        <form action={action}>
          <Button
            type="primary"
            icon={<GithubOutlined />}
            htmlType="submit"
            block
          >
            用 GitHub 登录
          </Button>
        </form>
      </Card>
    </Flex>
  )
}
