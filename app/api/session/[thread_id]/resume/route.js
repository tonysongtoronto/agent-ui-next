// app/api/session/[thread_id]/resume/route.js
// ★ HITL 改动：POST /api/session/:thread_id/resume?user_id=...
//   → Python POST /session/{user_id}/{thread_id}/resume
//
// Body: { decisions: [{ task_id, action, patch }] }，原样透传。

import { proxyJSON } from '../../../../../lib/proxy'

export async function POST(request, { params }) {
  const { thread_id } = await params
  const userId = new URL(request.url).searchParams.get('user_id') || 'default'
  const body = await request.text()   // 原样透传，避免重新序列化导致字段丢失
  return proxyJSON(`/session/${encodeURIComponent(userId)}/${thread_id}/resume`, {
    method: 'POST',
    body,
  })
}
