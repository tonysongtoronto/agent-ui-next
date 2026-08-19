// lib/client.js  ——  最终正确版
// ────────────────────────────────────────────────────────
// 架构说明：
//
//   浏览器 → Next.js /api/* → Python api.py (localhost:8000)
//              （透明代理）      （LangGraph + MCP + LangSmith）
//
// 这个文件里的所有函数都调用 /api/... 相对路径，
// Next.js 的 API Route 再代理到 Python api.py。
//
// baseUrl 输入框的作用：
//   AppShell 顶部的地址栏让用户可以改 Python 后端地址。
//   修改后会存到 localStorage，并通过 /api/config 告诉
//   Next.js 服务端用哪个地址做代理。
//   （目前阶段：地址变更在 .env.local 里配置，输入框仅做显示）
// ────────────────────────────────────────────────────────

// ── BaseUrl 管理（显示用 + localStorage 持久化）─────────
let _baseUrl = null

export const getBaseUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:8000'
  if (!_baseUrl) {
    _baseUrl = localStorage.getItem('agentBaseUrl') || 'http://localhost:8000'
  }
  return _baseUrl
}

export const setBaseUrl = (url) => {
  _baseUrl = url.replace(/\/$/, '')
  if (typeof window !== 'undefined') {
    localStorage.setItem('agentBaseUrl', _baseUrl)
  }
}

// ── 通用 JSON 请求（走 Next.js 代理层）─────────────────
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const j = await res.json(); detail = j.detail || j.error || detail } catch {}
    throw new Error(detail)
  }

  return res.json()
}

// ── Health ──────────────────────────────────────────────
// → Next.js GET /api/health → Python GET /health
export const apiHealth = () => request('/health')

// ── ★ 新增：SSE 帧解析的公共逻辑 ─────────────────────────
// apiChatStream（/chat/stream）和 apiResumeTaskPlanStream（/resume/stream）
// 后端推的事件格式完全一样（event:interrupted / event:rejected /
// [WAITING_HUMAN:tid] / [DONE:tid] / [ERROR] / 普通 token），
// 所以把"读 body 流 → 按行切 SSE 帧 → 分发给对应回调"这段逻辑抽成
// 一个公共函数，两个 API 各自只负责"怎么发起这次 fetch"。
//
// ★ HITL 改动：SSE 流现在可能出现一种新的收尾方式——被 human_review_gate
//   的 interrupt() 冻结，而不是正常跑到 final_answer。这种情况下后端会推：
//     event: interrupted
//     data: {"plan_status": "waiting_human", "pending_gate_items": [...]}
//
//     data: [WAITING_HUMAN:<thread_id>]
//   而不是普通的 `data: [DONE:<thread_id>]`。
//   下面的解析器：
//     - 识别 `event: xxx` 行，记住它，配对给紧跟着的下一条 `data:` 行
//     - `event: interrupted` 对应的 data 是 JSON，调用 onInterrupted(payload)，
//       不会把这段 JSON 当成普通回答 token 拼进 fullText
//     - `[WAITING_HUMAN:...]` 视为本轮流式的终点（类似 [DONE]），但不算
//       "正常完成"，调用 onInterrupted 后直接 return，不再调用 onDone
//     - `event: rejected`（线程当前还冻结在上一轮审核，本轮请求被拒绝）
//       对应的 data 也是 JSON，调用 onRejected(payload)
async function _consumeSSE(res, { onToken, onDone, onError, onInterrupted, onRejected, initialThreadId = '' }) {
  let fullText = ''
  let resolvedThreadId = initialThreadId

  // Python api.py 在响应头里返回 thread_id
  const headerTid = res.headers.get('x-thread-id')
  if (headerTid) resolvedThreadId = headerTid

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let pendingEvent = 'message'   // 当前这个 data: 行所属的 event 类型（默认普通消息）

  // ★ 修复：原来的 rejected/[WAITING_HUMAN]/[DONE]/[ERROR] 分支直接 return，
  //   没有显式 cancel 底层的 reader，遇到网络异常等边缘情况时，
  //   这个 ReadableStream 可能不会被及时关闭。统一包一层，所有提前退出
  //   路径都先 reader.cancel() 再返回。
  const stop = (fn) => { try { reader.cancel() } catch { /* 忽略：可能已经关闭 */ } ; fn?.() }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        pendingEvent = line.slice(7).trim()
        continue
      }
      if (line === '') {
        // SSE 一条消息以空行结束，重置 event 类型，回到默认 'message'
        pendingEvent = 'message'
        continue
      }
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      const thisEvent = pendingEvent
      pendingEvent = 'message'   // 只对紧跟着 event: 的那一条 data 生效

      if (thisEvent === 'interrupted') {
        let payload = {}
        try { payload = JSON.parse(data) } catch { /* 忽略解析失败，给个空对象兜底 */ }
        onInterrupted?.(payload, resolvedThreadId)
        continue   // 后面紧跟着的 [WAITING_HUMAN:...] 会触发真正的 return
      }
      if (thisEvent === 'rejected') {
        let payload = {}
        try { payload = JSON.parse(data) } catch { /* ignore */ }
        stop(() => onRejected?.(payload))
        return
      }

      if (data.startsWith('[WAITING_HUMAN')) {
        const tid = data.includes(':') ? data.split(':')[1].replace(']', '') : resolvedThreadId
        if (tid) resolvedThreadId = tid
        stop()   // 不算"正常完成"，不调用 onDone
        return
      }
      if (data.startsWith('[DONE')) {
        const tid = data.includes(':') ? data.split(':')[1].replace(']', '') : resolvedThreadId
        stop(() => onDone?.(tid)); return
      }
      if (data.startsWith('[ERROR]')) { stop(() => onError?.(data.slice(7).trim())); return }

      fullText += data
      onToken?.(data, fullText)
    }
  }
  onDone?.(resolvedThreadId)
}

// ── Chat Stream（SSE 流式）──────────────────────────────
// → Next.js POST /api/chat → Python GET /chat/stream (SSE)
// Python 内部：LangGraph agent 调用 → MCP 工具 → LangSmith 追踪 → SQLite 持久化
export function apiChatStream({ question, thread_id = '', onToken, onDone, onError, onInterrupted, onRejected }) {
  const controller = new AbortController()

  ;(async () => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, thread_id }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      await _consumeSSE(res, { onToken, onDone, onError, onInterrupted, onRejected, initialThreadId: thread_id })
    } catch (e) {
      if (e.name !== 'AbortError') onError?.(e.message)
    }
  })()

  return controller
}

// ── ★ 新增：Resume Stream（提交人工决策，流式恢复）──────────
// → Next.js POST /api/session/{thread_id}/resume/stream?user_id=...
//   → Python POST /session/{user_id}/{thread_id}/resume/stream (SSE)
//
// decisions 格式跟 apiResumeTaskPlan 完全一样：[{ task_id, action, patch }]。
// 区别是：恢复后如果图一路跑到 final_answer_node，会逐 token 触发 onToken，
// 而不是等生成完毕才 resolve 一整段 answer；如果又冻结了（新一批
// pending_gate_items），走 onInterrupted，跟 apiChatStream 语义完全一致。
export function apiResumeTaskPlanStream({ thread_id, decisions, userId = 'default', onToken, onDone, onError, onInterrupted, onRejected }) {
  const controller = new AbortController()

  ;(async () => {
    try {
      const res = await fetch(`/api/session/${thread_id}/resume/stream?user_id=${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try { const j = await res.json(); detail = j.detail || detail } catch { /* body 不是 JSON（比如 SSE 错误帧），忽略 */ }
        throw new Error(detail)
      }

      await _consumeSSE(res, { onToken, onDone, onError, onInterrupted, onRejected, initialThreadId: thread_id })
    } catch (e) {
      if (e.name !== 'AbortError') onError?.(e.message)
    }
  })()

  return controller
}

// ── Chat 非流式（兼容）─────────────────────────────────
// /api/chat 实际返回 SSE 流，不是 JSON，所以不能用 request()。
// 这里同样读取 SSE 流，把所有 token 拼完后以 { answer, thread_id } resolve，
// 让 ChatPanel 里的 .then(res => res.answer) 用法保持不变。
//
// ★ HITL 改动：resolve 出来的对象新增 interrupted / gateItems 两个字段。
//   interrupted=true 时 answer 为空字符串，调用方应该引导用户去
//   「人工审核」面板处理，而不是把空字符串当成真的回答显示出来。
export function apiChat(question, thread_id = '') {
  return new Promise((resolve, reject) => {
    let fullText = ''
    let resolvedThreadId = thread_id

    apiChatStream({
      question,
      thread_id,
      onToken: (_, full) => { fullText = full },
      onDone:  (tid)     => resolve({ answer: fullText, thread_id: tid || resolvedThreadId, interrupted: false, gateItems: [] }),
      onError: (err)     => reject(new Error(err)),
      onInterrupted: (payload, tid) => {
        resolvedThreadId = tid || resolvedThreadId
        resolve({
          answer:      '',
          thread_id:   resolvedThreadId,
          interrupted: true,
          planStatus:  payload.plan_status || 'waiting_human',
          gateItems:   payload.pending_gate_items || [],
        })
      },
      onRejected: (payload) => {
        reject(new Error(payload.message || '当前会话存在待人工处理的任务，请先前往「人工审核」面板处理'))
      },
    })
  })
}

// ── Session 管理 ────────────────────────────────────────
// → Python POST /session/new
export const apiNewSession = () =>
  request('/session/new', { method: 'POST' })

// → Python DELETE /session/{thread_id}
export const apiClearSession = (thread_id) =>
  request(`/session/${thread_id}`, { method: 'DELETE' })

// ── ★ HITL 改动：任务计划状态查询 + 人工决策恢复 ─────────
// → Next.js GET /api/session/{thread_id}/state?user_id=... → Python GET /session/{user_id}/{thread_id}/state
// 直接读 LangGraph checkpoint 的最新真相，不需要额外的存储层。
export const apiGetTaskPlanState = (thread_id, userId = 'default') =>
  request(`/session/${thread_id}/state?user_id=${encodeURIComponent(userId)}`)

// → Next.js POST /api/session/{thread_id}/resume?user_id=... → Python POST /session/{user_id}/{thread_id}/resume
// decisions: [{ task_id, action, patch }]，一次性批量提交本批全部待办事项的决策
export const apiResumeTaskPlan = (thread_id, decisions, userId = 'default') =>
  request(`/session/${thread_id}/resume?user_id=${encodeURIComponent(userId)}`, {
    method: 'POST',
    body: JSON.stringify({ decisions }),
  })

// → Next.js POST /api/session/{thread_id}/abort?user_id=... → Python POST /session/{user_id}/{thread_id}/abort
// 放弃当前中断，直接终止整个任务计划，不需要知道具体待办事项的 task_id
export const apiAbortTaskPlan = (thread_id, userId = 'default') =>
  request(`/session/${thread_id}/abort?user_id=${encodeURIComponent(userId)}`, { method: 'POST' })

// ── ★ 新增：Abort Stream（流式终止任务计划）──────────────
// → Next.js POST /api/session/{thread_id}/abort/stream?user_id=...
//   → Python POST /session/{user_id}/{thread_id}/abort/stream (SSE)
//
// 语义跟 apiAbortTaskPlan 完全一样（终止整个任务计划，不需要传 decisions），
// 区别是：图路由到 final_answer_node 后，会逐 token 触发 onToken，而不是
// 等生成完毕才 resolve 一整段 answer。理论上不会走 onInterrupted（abort_all
// 之后 plan_status 直接变 aborted，gate_route 只会去 final_answer），但还是
// 接了这个回调，跟 apiResumeTaskPlanStream 保持同一套接口形状，方便复用
// _consumeSSE。
export function apiAbortTaskPlanStream({ thread_id, userId = 'default', onToken, onDone, onError, onInterrupted, onRejected }) {
  const controller = new AbortController()

  ;(async () => {
    try {
      const res = await fetch(`/api/session/${thread_id}/abort/stream?user_id=${encodeURIComponent(userId)}`, {
        method: 'POST',
        signal: controller.signal,
      })

      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try { const j = await res.json(); detail = j.detail || detail } catch { /* body 不是 JSON（比如 SSE 错误帧），忽略 */ }
        throw new Error(detail)
      }

      await _consumeSSE(res, { onToken, onDone, onError, onInterrupted, onRejected, initialThreadId: thread_id })
    } catch (e) {
      if (e.name !== 'AbortError') onError?.(e.message)
    }
  })()

  return controller
}

// ── Memory 管理 ─────────────────────────────────────────
// → Python GET /memory  → { system: {key:value}, user: {user_id: {key:value}} }
export const apiListMemory = () => request('/memory')

// → Python POST /memory
// namespace: 'system' | 'user'；namespace='user' 时 userId 必填
export const apiPutMemory = (key, value, namespace = 'system', userId = null) =>
  request('/memory', {
    method: 'POST',
    body: JSON.stringify({ key, value, namespace, user_id: userId }),
  })

// → Python DELETE /memory/{key}?namespace=...&user_id=...
export const apiDeleteMemory = (key, namespace = 'system', userId = null) => {
  const qs = new URLSearchParams({ namespace, ...(userId ? { user_id: userId } : {}) })
  return request(`/memory/${encodeURIComponent(key)}?${qs}`, { method: 'DELETE' })
}

// ── LangSmith Traces ────────────────────────────────────
// [Fix 3] 改用通用 request() 封装，确保 4xx/5xx 时正确抛出异常，
// 而不是把 { error: "..." } 当成正常数据 resolve，导致前端崩溃
export const apiListTraces = ({ limit = 20, filter = '', cursor = null } = {}) => {
  const p = new URLSearchParams()
  if (limit)  p.set('limit',  limit)
  if (filter) p.set('filter', filter)
  if (cursor) p.set('cursor', cursor)   // ISO timestamp 游标，null = 第一页
  return request(`/traces?${p}`)
}

export const apiGetTrace = (runId) => request(`/traces/${runId}`)

// ── UI Sessions（别名 / Pin）────────────────────────────
export const apiListUiSessions = () =>
  request('/ui/sessions')

export const apiSaveUiSession = (thread_id, data) =>
  request('/ui/sessions', { method: 'POST', body: JSON.stringify({ thread_id, ...data }) })

export const apiUpdateUiSession = (thread_id, data) =>
  request(`/ui/sessions/${thread_id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const apiDeleteUiSession = (thread_id) =>
  request(`/ui/sessions/${thread_id}`, { method: 'DELETE' })

// ── UI Prompts 收藏夹 ────────────────────────────────────
export const apiListPrompts = () =>
  request('/ui/prompts')

export const apiCreatePrompt = (data) =>
  request('/ui/prompts', { method: 'POST', body: JSON.stringify(data) })

export const apiUpdatePrompt = (id, data) =>
  request(`/ui/prompts/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const apiDeletePrompt = (id) =>
  request(`/ui/prompts/${id}`, { method: 'DELETE' })

// ── UI Prefs 用户偏好 ────────────────────────────────────
export const apiGetPrefs  = () => request('/ui/prefs')
export const apiSavePrefs = (patch) =>
  request('/ui/prefs', { method: 'PATCH', body: JSON.stringify(patch) })

// ── UI Logs 操作日志（持久化到 ui.db）───────────────────
// GET  /api/ui/logs            → 读取全部日志（最新优先，最多 100 条）
export const apiListLogs = () => request('/ui/logs')

// POST /api/ui/logs            → 写入一条日志  { type, msg }
export const apiAddLog = (type, msg) =>
  request('/ui/logs', { method: 'POST', body: JSON.stringify({ type, msg }) })

// DELETE /api/ui/logs          → 清空所有日志
export const apiClearLogs = () =>
  request('/ui/logs', { method: 'DELETE' })

// curl http://localhost:3000/api/test
export const hellowolrld = () =>
  request('/test')


// 打开 http://localhost:3000 → 按 F12 → Console → 粘贴：
// fetch('/api/test', {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json' },
//   body: JSON.stringify({
//     title: '测试标题',
//     content: '测试内容',
//     tags: 'tag1'
//   })
// })
// .then(res => res.json())
// .then(data => console.log(data))

// fetch('/api/test', {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json' },
//   body: JSON.stringify({
//     content: '测试内容',
//     tags: 'tag1'
//   })
// })
// .then(res => res.json())
// .then(data => console.log(data))

export const helloWorld = (data) =>
  request('/test', { method: 'POST', body: JSON.stringify(data) })


export const helloDelete = (id) =>
  request(`/test/${id}`, { method: 'DELETE' })