// hooks/useAwaitingHuman.js
// ────────────────────────────────────────────────────────
// ★ HITL 改动：轮询"当前共享会话"（lib/shared.js 里存的那个
//   thread_id/user_id）是否冻结在 human_review_gate，用于在
//   AppShell 侧边栏「人工审核」这一项旁边显示一个提醒红点——
//   跟 Health 面板出错时显示 errDot 是同一套视觉语言。
//
// 只在有 thread_id 时才轮询（避免应用刚打开、还没发过消息时
// 就不停地打空请求）；thread_id 变化时（比如用户在别的面板
// 新建了会话）会自动重新订阅。
// ────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { apiGetTaskPlanState } from '../lib/client.js'
import { getCurrentThread, onCurrentThreadChange } from '../lib/shared.js'
import { classifyGateItems } from '../lib/guardrail.js'

export function useAwaitingHuman(autoRefreshMs = 8000) {
  const [thread, setThread]   = useState(() => getCurrentThread())
  const [isAwaiting, setIsAwaiting] = useState(false)
  const [gateCount, setGateCount]   = useState(0)
  // ★ Guardrail 改动：额外暴露"这批待办事项里有没有 guardrail 触发的"，
  //   供 AppShell 侧边栏把提醒红点在安全相关时换成更醒目的样式。
  const [hasGuardrail, setHasGuardrail] = useState(false)

  const check = useCallback(async (t) => {
    if (!t?.threadId) { setIsAwaiting(false); setGateCount(0); setHasGuardrail(false); return }
    try {
      const res = await apiGetTaskPlanState(t.threadId, t.userId)
      const items = res.pending_gate_items || []
      setIsAwaiting(!!res.is_awaiting_human)
      setGateCount(items.length)
      setHasGuardrail(classifyGateItems(items).hasGuardrail)
    } catch {
      // 会话不存在（404）或后端未就绪，静默忽略，不打扰用户
      setIsAwaiting(false)
      setGateCount(0)
      setHasGuardrail(false)
    }
  }, [])

  // 订阅"当前共享会话"变化
  useEffect(() => onCurrentThreadChange((t) => setThread(t)), [])

  // 轮询
  useEffect(() => {
    check(thread) // eslint-disable-line react-hooks/set-state-in-effect -- 订阅外部系统（轮询后端状态），属于合法用法
    const timer = setInterval(() => check(thread), autoRefreshMs)
    return () => clearInterval(timer)
  }, [thread, autoRefreshMs, check])

  return { isAwaiting, gateCount, hasGuardrail, thread }
}