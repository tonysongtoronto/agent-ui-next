// app/api/memory/[key]/route.js
// DELETE /api/memory/:key?namespace=system|user&user_id=... → Python DELETE /memory/{key}?...
//
// Python 内部从 AsyncSqliteStore 永久删除该条记忆。
// namespace/user_id 透传自浏览器的 query string，原样转给 Python 后端。

import { proxyJSON } from '../../../../lib/proxy'

export async function DELETE(request, { params }) {
  const { key } = await params
  const qs = new URL(request.url).search  // 例如 "?namespace=user&user_id=alice"
  return proxyJSON(`/memory/${encodeURIComponent(key)}${qs}`,
  { method: 'DELETE' })
}