// app/api/session/new/route.js
// POST /api/session/new → Python POST /session/new
// 返回：{ thread_id: "user_xxxx", created_at: 1234567890 }

import { proxyJSON } from '../../../../lib/proxy'

export async function POST() {
  return proxyJSON('/session/new', { method: 'POST' })
}
