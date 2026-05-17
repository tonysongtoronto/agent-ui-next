// app/api/chat/route.js
// ────────────────────────────────────────────────────────
// POST /api/chat → 透明代理 → Python GET /chat/stream (SSE)
//
// 这是最关键的接口！
//
// 前端（client.js）发送：
//   POST /api/chat
//   Body: { question: "...", thread_id: "..." }
//
// 我们转发给 Python api.py：
//   GET http://localhost:8000/chat/stream?question=...&thread_id=...
//
// Python api.py 内部执行：
//   1. agent_module.graph.ainvoke(...)   ← LangGraph 并行 agent
//   2. MCP 工具调用（网页搜索、代码执行等）
//   3. LangSmith 自动追踪整个执行链路
//   4. SQLite checkpoint 持久化对话历史
//   5. 逐 token SSE 推送回来
//
// 我们把这个 SSE 流原封不动地透传给浏览器。
// ────────────────────────────────────────────────────────

import { proxySSE } from '../../../lib/proxy'

export async function POST(request) {
  const { question, thread_id } = await request.json()
  return proxySSE(question, thread_id)
}

// GET 兼容（BatchPanel 等可能直接 GET）
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  return proxySSE(
    searchParams.get('question') || '',
    searchParams.get('thread_id') || ''
  )
}
