/** @type {import('next').NextConfig} */
const nextConfig = {
  // ★ 关掉开发环境右下角那个 static/dynamic 小徽标提示（"The path `/` is
  //   marked as static..."），纯粹是视觉上的开发工具，不影响任何构建/
  //   运行行为，跟 hydration mismatch 那几个改动没有关系。
  devIndicators: false,

  // 开发时把 /api/* 请求代理到 Python 后端（可选，也可用顶部 Base URL 输入框）
  async rewrites() {
    return [
      {
        source: '/proxy/:path*',
        destination: 'http://localhost:8000/:path*',
      },
    ]
  },
}

export default nextConfig