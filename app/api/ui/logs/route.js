// app/api/ui/logs/route.js
// GET    /api/ui/logs   → 读取所有操作日志（最新优先，最多 100 条）
// POST   /api/ui/logs   → 写入一条日志  body: { type, msg }
// DELETE /api/ui/logs   → 清空所有日志

import { dbListLogs, dbAddLog, dbClearLogs } from '../../../../lib/db'

export async function GET() {
  try {
    const logs = await dbListLogs()
  
    return Response.json({ logs })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { type, msg } = await request.json()
    if (!msg?.trim()) {
      return Response.json({ error: 'msg 不能为空' }, { status: 400 })
    }
    const log = await dbAddLog(type ?? 'ok', msg.trim())
    return Response.json({ log })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await dbClearLogs()
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}