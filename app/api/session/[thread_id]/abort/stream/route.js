// app/api/session/[thread_id]/abort/stream/route.js
// ★ 新增：POST /api/session/:thread_id/abort/stream?user_id=...
//   → Python POST /session/{user_id}/{thread_id}/abort/stream (SSE)
//
// 跟同目录下的 ../abort/route.js 语义完全一样（终止整个任务计划，
// 不需要提交任何 body），唯一区别是这次 Python 那边是流式接口，
// 用 proxyAbortSSE 把字节流原样透传，而不是像 proxyJSON 那样等整段
// 响应体读完再转发。

import { proxyAbortSSE } from '../../../../../../lib/proxy'

export async function POST(request, { params }) {
  const { thread_id } = await params
  const userId = new URL(request.url).searchParams.get('user_id') || 'default'
  return proxyAbortSSE(thread_id, userId)
}
