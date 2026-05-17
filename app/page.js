// app/page.js
// ────────────────────────────────────────────────────────
// 根路由页面（Server Component）
// 直接渲染客户端 AppShell 组件
// ────────────────────────────────────────────────────────

import AppShell from '../components/AppShell'

export default function Home() {
  return <AppShell />
}
