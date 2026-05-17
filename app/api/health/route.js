// app/api/health/route.js
// ────────────────────────────────────────────────────────
// GET /api/health → 透明代理 → Python GET /health
//
// 返回 Python api.py 的真实健康数据：
//   {
//     status: "ok" | "degraded" | "initializing",
//     tool_count: 8,        ← 真实 MCP 工具数量
//     agents: [...],        ← 真实 Agent 列表
//     uptime_seconds: 123,
//     checkpoint_db: "checkpoints.db"
//   }
// ────────────────────────────────────────────────────────

import { proxyJSON } from '../../../lib/proxy'

export async function GET() {
  return proxyJSON('/health')
}
