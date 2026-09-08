// app/api/guardrail/rules/route.js
// ★ Guardrail 改动：GET /api/guardrail/rules
//   → Python GET /guardrail/rules
//
// 返回全部规则类别及启用状态，供后续「规则管理」页面渲染开关列表用。
// 单条规则的启用/禁用走 app/api/guardrail/rules/[category]/route.js。

import { proxyJSON } from '../../../../lib/proxy'

export async function GET() {
  return proxyJSON('/guardrail/rules')
}
