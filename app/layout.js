// app/layout.js
// ────────────────────────────────────────────────────────
// Next.js 根布局（Server Component）
// 相当于原来的 index.html + main.jsx 的合体
// 注意：这里是服务端组件，不能写 useState / useEffect 等
// ────────────────────────────────────────────────────────

import './globals.css'

export const metadata = {
  title: 'Agent UI — Test Console',
  description: 'LangGraph Agent 测试控制台',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* Google Fonts — 和原来 index.html 一样 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Sora:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
