/** @type {import('next').NextConfig} */
const nextConfig = {
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
