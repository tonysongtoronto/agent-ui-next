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
    // ★ Hydration fix：Darkreader 之类的浏览器扩展会在 React hydrate 之前
    //   就往根 <html> 标签上加 data-darkreader-mode / data-darkreader-scheme
    //   等属性，导致服务端渲染的 HTML 和客户端实际 DOM 对不上，报 hydration
    //   mismatch。这不是应用代码的 bug，是 Next.js 官方文档也专门提到的场景
    //   （浏览器扩展修改 <html>/<body>），推荐直接在根标签加
    //   suppressHydrationWarning 来忽略这类由扩展引入、无法控制的差异。
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Google Fonts — 和原来 index.html 一样 */}
        {/* eslint-disable @next/next/no-page-custom-font --
            这条规则是给 Pages Router 的 pages/_document.js 场景设计的，
            提醒"别把全局字体散落在单个页面里"。这里用的是 App Router，
            app/layout.js 本身就是 Next.js 官方文档推荐的全局字体存放位置，
            规则还没适配 App Router，属于误报。 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Sora:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* eslint-enable @next/next/no-page-custom-font */}
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}