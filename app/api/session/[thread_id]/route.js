// app/api/session/[thread_id]/route.js
// DELETE /api/session/:thread_id → Python DELETE /session/{thread_id}
//
// Python 内部会从 SQLite checkpoints.db 里永久删除该 thread 的历史。

import { proxyJSON } from '../../../../lib/proxy'

export async function DELETE(request, { params }) {
  const { thread_id } = await params
  return proxyJSON(`/session/${thread_id}`, { method: 'DELETE' })
}
