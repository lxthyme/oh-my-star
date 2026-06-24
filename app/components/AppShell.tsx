"use client"

import Link from "next/link"
import { Layout, Menu } from "antd"

const NAV_ITEMS = [
  { key: "/repos", label: <Link href="/repos">我的仓库</Link> },
  { key: "/stars", label: <Link href="/stars">已 Star</Link> },
]

export default function AppShell({ children }: React.PropsWithChildren) {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header>
        <Menu theme="dark" mode="horizontal" items={NAV_ITEMS} selectable={false} />
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
    </Layout>
  )
}
