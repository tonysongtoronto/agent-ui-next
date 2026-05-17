// app/api/ui/sessions/route.js
// GET  /api/ui/sessions         → 所有会话元数据（别名、pin）
// POST /api/ui/sessions         → 新建或更新会话元数据

import { dbListSessions, dbUpsertSession } from '../../../../lib/db'

export async function GET() {
  try {
    const sessions = await dbListSessions()
    return Response.json({ sessions })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { thread_id, label, pinned, note } = await request.json()
    if (!thread_id?.trim()) {
      return Response.json({ error: 'thread_id 不能为空' }, { status: 400 })
    }
    const session = await dbUpsertSession(thread_id.trim(), { label, pinned, note })
    return Response.json({ session })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
