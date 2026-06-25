"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ConfigProvider,
  Dropdown,
  Layout,
  Menu,
  Tooltip,
  theme,
  type MenuProps,
} from "antd"
import {
  StarFilled,
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
  SyncOutlined,
} from "@ant-design/icons"
import { THEME_STORAGE_KEY, resolveTheme, type ThemeMode } from "../lib/theme"
import { SyncProvider, useSync } from "./SyncContext"

const NAV_ITEMS = [
  { key: "/repos", label: <Link href="/repos">我的仓库</Link> },
  { key: "/stars", label: <Link href="/stars">已 Star</Link> },
]

const THEME_MODE_ICONS: Record<ThemeMode, React.ReactNode> = {
  light: <SunOutlined />,
  dark: <MoonOutlined />,
  system: <DesktopOutlined />,
}

const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: "亮色",
  dark: "暗色",
  system: "跟随系统",
}

function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>("system")
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    // 首次挂载时同步已持久化的选择与系统偏好，必然 setState，
    // react-hooks/set-state-in-effect 对此场景误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(stored === "light" || stored === "dark" ? stored : "system")

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    setPrefersDark(media.matches)
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const isDark = resolveTheme(mode, prefersDark) === "dark"

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      isDark ? "dark" : "light",
    )
  }, [isDark])

  const setMode = (next: ThemeMode) => {
    setModeState(next)
    if (next === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    }
  }

  return { mode, isDark, setMode }
}

function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SyncButton() {
  const { lastSyncedAt, syncing, triggerSync } = useSync()
  const label = lastSyncedAt
    ? `上次同步：${formatSyncTime(lastSyncedAt)}`
    : "从未同步"

  return (
    <Tooltip title={label}>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          color: "#fff",
        }}
      >
        <span
          className="hidden sm:inline"
          style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}
        >
          {label}
        </span>
        <a
          onClick={(e) => {
            e.preventDefault()
            triggerSync()
          }}
          style={{ color: "#fff", fontSize: 18, cursor: "pointer" }}
        >
          <SyncOutlined spin={syncing} />
        </a>
      </span>
    </Tooltip>
  )
}

export default function AppShell({ children }: React.PropsWithChildren) {
  const { mode, isDark, setMode } = useThemeMode()

  const themeMenuItems: MenuProps["items"] = (
    ["light", "dark", "system"] as ThemeMode[]
  ).map((m) => ({
    key: m,
    label: THEME_MODE_LABELS[m],
    icon: THEME_MODE_ICONS[m],
  }))

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
      <SyncProvider>
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
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#fff",
                fontWeight: 600,
                flexShrink: 0,
              }}
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
            <SyncButton />
            <Dropdown
              menu={{
                items: themeMenuItems,
                selectedKeys: [mode],
                onClick: ({ key }) => setMode(key as ThemeMode),
              }}
              trigger={["click"]}
            >
              <a
                onClick={(e) => e.preventDefault()}
                style={{
                  color: "#fff",
                  fontSize: 18,
                  flexShrink: 0,
                  cursor: "pointer",
                }}
              >
                {THEME_MODE_ICONS[mode]}
              </a>
            </Dropdown>
          </Layout.Header>
          <Layout.Content style={{ padding: "16px 16px 32px" }}>
            <div className="page-container">{children}</div>
          </Layout.Content>
        </Layout>
      </SyncProvider>
    </ConfigProvider>
  )
}
