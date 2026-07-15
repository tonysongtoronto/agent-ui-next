// lib/proxy.js
// ────────────────────────────────────────────────────────
// 透明代理工具函数
//
// 所有 Next.js API Route 的职责只有一件事：
//   把浏览器的请求原封不动地转发给 Python api.py，
//   再把 api.py 的响应原封不动地返回给浏览器。
//
// 这样 LangGraph、MCP 工具调用、LangSmith 追踪、
// SQLite 持久化等所有真实逻辑全部在 Python 里运行，
// Next.js 只是一个"透明管道"。
//
// 目标地址由环境变量控制：
//   PYTHON_API_URL=http://localhost:8000   （默认值）
//
// ────────────────────────────────────────────────────────

// Python api.py 的地址（从环境变量读，默认 localhost:8000）
export const PYTHON_API =
  process.env.PYTHON_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8000'

/**
 * 通用 JSON 代理：转发 JSON 请求，返回 JSON 响应
 *
 * @param {string} path        - Python api.py 的路径，如 "/health"
 * @param {object} options     - fetch 选项（method, body, headers 等）
 * @returns {Response}
 */
export async function proxyJSON(path, options = {}) {
  try {
    const res = await fetch(`${PYTHON_API}${path}`, {
      ...options,
      cache: 'no-store',   // ← 加这一行
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    })

    // 把响应体和状态码原样透传
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
      },
    })
  } catch (err) {
    // Python 后端没有启动时，给前端一个清晰的错误
    const msg = err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')
      ? `无法连接 Python 后端 (${PYTHON_API})。请确认 api.py 已启动：uvicorn api:app --port 8000`
      : err.message

    return Response.json({ detail: msg }, { status: 503 })
  }
}

/**
 * SSE 流式代理：把 Python api.py 的 SSE 流透传给浏览器
 *
 * Python api.py 的流式接口是：
 *   GET /chat/stream?question=...&thread_id=...
 *
 * Next.js 前端调用的是：
 *   POST /api/chat { question, thread_id }
 *
 * 这个函数负责：
 *   1. 从 POST body 取出 question / thread_id
 *   2. 用 GET 请求调用 Python /chat/stream
 *   3. 把 SSE 流一字节不差地透传给浏览器
 *
 * @param {string} question
 * @param {string} thread_id
 * @returns {Response}  text/event-stream
 */
export async function proxySSE(question, thread_id = '') {
  const qs = new URLSearchParams({ question, thread_id: thread_id || '' })
  const url = `${PYTHON_API}/chat/stream?${qs}`

  // SSE 错误辅助（让前端 onError 正常触发）
  const sseErr = (msg) =>
    new Response(`data: [ERROR] ${msg}\n\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })

  let pythonRes
  try {
    pythonRes = await fetch(url, { method: 'GET' })
  } catch (err) {
    const msg = err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')
      ? `无法连接 Python 后端 (${PYTHON_API})。请确认 api.py 已启动：uvicorn api:app --port 8000`
      : err.message
    return sseErr(msg)
  }

  if (!pythonRes.ok) {
    const detail = await pythonRes.text()
    return sseErr(`Python api.py 返回 ${pythonRes.status}：${detail}`)
  }

  // 把 Python 的 ReadableStream 直接透传给浏览器
  // pythonRes.body 就是原始字节流，不做任何解析，逐块转发
  const headers = {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'X-Accel-Buffering': 'no',
  }

  // 把 X-Thread-Id header 从 Python 透传过来（前端需要用它更新 thread_id）
  const tid = pythonRes.headers.get('X-Thread-Id')
  if (tid) headers['X-Thread-Id'] = tid

  return new Response(pythonRes.body, { status: 200, headers })
}
