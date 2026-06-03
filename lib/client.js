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

// ── Chat Stream（SSE 流式）──────────────────────────────
// → Next.js POST /api/chat → Python GET /chat/stream (SSE)
// Python 内部：LangGraph agent 调用 → MCP 工具 → LangSmith 追踪 → SQLite 持久化
export function apiChatStream({ question, thread_id = '', onToken, onDone, onError }) {
  const controller = new AbortController()
  let fullText = ''
  let resolvedThreadId = thread_id

  ;(async () => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, thread_id }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Python api.py 在响应头里返回 thread_id
      const headerTid = res.headers.get('x-thread-id')
      if (headerTid) resolvedThreadId = headerTid

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)

          if (data.startsWith('[DONE')) {
            const tid = data.includes(':') ? data.split(':')[1].replace(']', '') : resolvedThreadId
            onDone?.(tid); return
          }
          if (data.startsWith('[ERROR]')) { onError?.(data.slice(7).trim()); return }

          fullText += data
          onToken?.(data, fullText)
        }
      }
      onDone?.(resolvedThreadId)
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
export function apiChat(question, thread_id = '') {
  return new Promise((resolve, reject) => {
    let fullText = ''
    let resolvedThreadId = thread_id

    apiChatStream({
      question,
      thread_id,
      onToken: (_, full) => { fullText = full },
      onDone:  (tid)     => resolve({ answer: fullText, thread_id: tid || resolvedThreadId }),
      onError: (err)     => reject(new Error(err)),
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

// ── Memory 管理 ─────────────────────────────────────────
// → Python GET /memory
export const apiListMemory = () => request('/memory')

// → Python POST /memory
export const apiPutMemory = (key, value) =>
  request('/memory', { method: 'POST', body: JSON.stringify({ key, value }) })

// → Python DELETE /memory/{key}
export const apiDeleteMemory = (key) =>
  request(`/memory/${encodeURIComponent(key)}`, { method: 'DELETE' })

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