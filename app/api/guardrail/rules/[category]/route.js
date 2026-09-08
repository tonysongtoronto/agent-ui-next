// app/api/guardrail/rules/[category]/route.js
// ★ Guardrail 改动：PUT /api/guardrail/rules/:category?enabled=true|false
//   → Python PUT /guardrail/rules/{category}?enabled=true|false
//
// 启用/禁用某一条 Guardrail 规则。enabled 用 query string 传（不是 body），
// 跟 Python 那边 `enabled: bool = Query(...)` 的签名保持一致，直接原样转发。
// category 不存在时 Python 会返回 404，这里也原样透传，不用额外处理。

import { proxyJSON } from '../../../../../lib/proxy'

export async function PUT(request, { params }) {
  const { category } = await params
  const enabled = new URL(request.url).searchParams.get('enabled') ?? 'true'
  return proxyJSON(
    `/guardrail/rules/${encodeURIComponent(category)}?enabled=${encodeURIComponent(enabled)}`,
    { method: 'PUT' },
  )
}
