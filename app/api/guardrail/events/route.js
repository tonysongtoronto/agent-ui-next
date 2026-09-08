// app/api/guardrail/events/route.js
// ★ Guardrail 改动：GET /api/guardrail/events?user_id=&thread_id=&stage=&limit=
//   → Python GET /guardrail/events?user_id=&thread_id=&stage=&limit=
//
// 透明代理：query string 原样转发给 Python（user_id/thread_id/stage/limit
// 都是可选参数，不传就用 Python 那边的默认值），响应体也原样透传，不做
// 任何字段改写——跟 lib/proxy.js 里其它代理路由的一贯做法一致。

import { proxyJSON } from '../../../../lib/proxy'

export async function GET(request) {
  const qs = new URL(request.url).search  // 含 "?"，没有参数时是空字符串
  return proxyJSON(`/guardrail/events${qs}`)
}
