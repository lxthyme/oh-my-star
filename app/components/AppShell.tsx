"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ConfigProvider, Layout, Menu, theme } from "antd"
import { StarFilled } from "@ant-design/icons"

const NAV_ITEMS = [
  { key: "/repos", label: <Link href="/repos">我的仓库</Link> },
  { key: "/stars", label: <Link href="/stars">已 Star</Link> },
]

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    // 首次挂载时同步系统当前主题，必然 setState，react-hooks/set-state-in-effect 对此场景误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(media.matches)
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return isDark
}

export default function AppShell({ children }: React.PropsWithChildren) {
  const isDark = useIsDarkMode()

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#0969da",
          colorSuccess: "#1a7f37",
          borderRadius: 8,
          fontFamily: "var(--font-sans)",
          colorBgLayout: isDark ? "#0d1117" : "#f6f8fa",
        },
        components: {
          Layout: { headerBg: "#161b22" },
          Card: { borderRadiusLG: 12 },
          Select: { controlHeight: 36 },
          Input: { controlHeight: 36 },
          Button: { controlHeightSM: 32 },
        },
      }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Layout.Header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 16,
            paddingInline: 16,
          }}
        >
          <Link
            href="/repos"
            style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontWeight: 600, flexShrink: 0 }}
          >
            <StarFilled style={{ fontSize: 18, color: "#fadb14" }} />
            <span style={{ whiteSpace: "nowrap" }}>GitHub Star 管理</span>
          </Link>
          <Menu
            theme="dark"
            mode="horizontal"
            items={NAV_ITEMS}
            selectable={false}
            style={{ flex: 1, minWidth: 0, background: "transparent" }}
          />
        </Layout.Header>
        <Layout.Content style={{ padding: "16px 16px 32px" }}>
          <div className="page-container">{children}</div>
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  )
}
