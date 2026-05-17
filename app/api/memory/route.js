// app/api/memory/route.js
// GET  /api/memory → Python GET  /memory  → { items: { key: value, ... } }
// POST /api/memory → Python POST /memory  → { success, key, value }
//
// Python 内部读写 AsyncSqliteStore（持久化到 checkpoints.db）

import { proxyJSON } from '../../../lib/proxy'

export async function GET() {
  return proxyJSON('/memory')
}

export async function POST(request) {
  const body = await request.text()
  return proxyJSON('/memory', {
    method: 'POST',
    body,
  })
}
