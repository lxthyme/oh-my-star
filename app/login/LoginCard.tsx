"use client"

import { Button, Card, Flex, Typography } from "antd"
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
