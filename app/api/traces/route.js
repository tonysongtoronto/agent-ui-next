// app/api/traces/route.js
// GET /api/traces?limit=20&filter=... → LangSmith run 列表
//
// 在服务端带 LANGSMITH_API_KEY 调用 LangSmith REST API，
// 浏览器永远看不到 API Key。

import { listRuns } from '../../../lib/langsmith'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20'), 50)
  const filter = searchParams.get('filter') ?? ''
  const offset = parseInt(searchParams.get('offset') ?? '0')

  try {
    const result = await listRuns({ limit, filter, offset })
    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err.message, runs: [] },
      { status: err.message.includes('未配置') ? 503 : 502 }
    )
  }
}