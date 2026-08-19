// app/api/session/[thread_id]/state/route.js
// ★ HITL 改动：GET /api/session/:thread_id/state?user_id=...
//   → Python GET /session/{user_id}/{thread_id}/state
//
// user_id 用 query string 传（不用路径段），跟 app/api/memory/[key]/route.js
// 的既有约定保持一致——这样不需要新建一个跟现有 [thread_id] 目录
// "同级但参数名不同"的动态路由（Next.js 不允许同一位置出现两个不同名字
// 的动态段，比如 [thread_id] 和 [user_id] 不能同时是 app/api/session/
// 下的直接子目录，会在构建时报错）。

import { proxyJSON } from '../../../../../lib/proxy'

export async function GET(request, { params }) {
  const { thread_id } = await params
  const userId = new URL(request.url).searchParams.get('user_id') || 'default'
  return proxyJSON(`/session/${encodeURIComponent(userId)}/${thread_id}/state`)
}
