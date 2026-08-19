// app/api/session/[thread_id]/resume/stream/route.js
// ★ 新增：POST /api/session/:thread_id/resume/stream?user_id=...
//   → Python POST /session/{user_id}/{thread_id}/resume/stream (SSE)
//
// 跟同目录下的 ../resume/route.js 提交格式完全一样：{ decisions: [...] }
// 唯一区别：Python 那边这次是流式接口，用 proxyResumeSSE 把字节流原样透传，
// 而不是像 proxyJSON 那样等整段响应体读完再转发。

import { proxyResumeSSE } from '../../../../../../lib/proxy'

export async function POST(request, { params }) {
  const { thread_id } = await params
  const userId = new URL(request.url).searchParams.get('user_id') || 'default'
  const body = await request.text()   // 原样透传，避免重新序列化导致字段丢失
  return proxyResumeSSE(thread_id, userId, body)
}
