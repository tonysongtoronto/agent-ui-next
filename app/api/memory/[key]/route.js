// app/api/memory/[key]/route.js
// DELETE /api/memory/:key → Python DELETE /memory/{key}
//
// Python 内部从 AsyncSqliteStore 永久删除该条记忆。

import { proxyJSON } from '../../../../lib/proxy'

export async function DELETE(request, { params }) {
  const { key } = await params
  return proxyJSON(`/memory/${encodeURIComponent(key)}`, 
  { method: 'DELETE' })
}
