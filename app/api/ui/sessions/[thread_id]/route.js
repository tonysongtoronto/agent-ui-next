// app/api/ui/sessions/[thread_id]/route.js
// PATCH  /api/ui/sessions/:thread_id → 更新别名 / pin / 备注
// DELETE /api/ui/sessions/:thread_id → 删除 UI 元数据（不影响 LangGraph checkpoint）

import { dbUpsertSession, dbDeleteSession } from '../../../../../lib/db'

export async function PATCH(request, { params }) {
  const { thread_id } = await params
  try {
    const body = await request.json()
    const session = await dbUpsertSession(thread_id, body)
    return Response.json({ session })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const { thread_id } = await params
  try {
    await dbDeleteSession(thread_id)
    return Response.json({ success: true, thread_id })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
