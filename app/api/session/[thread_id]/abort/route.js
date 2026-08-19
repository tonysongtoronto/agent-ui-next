// app/api/session/[thread_id]/abort/route.js
// ★ HITL 改动：POST /api/session/:thread_id/abort?user_id=...
//   → Python POST /session/{user_id}/{thread_id}/abort
//
// 放弃当前中断，直接终止整个任务计划，不需要提交任何 body。

import { proxyJSON } from '../../../../../lib/proxy'

export async function POST(request, { params }) {
  const { thread_id } = await params
  const userId = new URL(request.url).searchParams.get('user_id') || 'default'
  return proxyJSON(`/session/${encodeURIComponent(userId)}/${thread_id}/abort`, {
    method: 'POST',
  })
}
