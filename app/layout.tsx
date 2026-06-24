import type { Metadata, Viewport } from "next"
import { AntdRegistry } from "@ant-design/nextjs-registry"
import AppShell from "./components/AppShell"
import "./globals.css"

export const metadata: Metadata = {
  title: "GitHub Star 管理",
  description: "管理 GitHub 仓库与 Star 的个人工具",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
}

const RootLayout = ({ children }: React.PropsWithChildren) => (
  <html lang="zh-CN">
    <body>
      <AntdRegistry>
        <AppShell>{children}</AppShell>
      </AntdRegistry>
    </body>
  </html>
)

export default RootLayout
