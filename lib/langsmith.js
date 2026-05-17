// lib/langsmith.js
// ────────────────────────────────────────────────────────
// LangSmith REST API 封装（Next.js 服务端专用）
//
// GET  /sessions?name=<name>   → 拿 session UUID（已验证可用）
// POST /runs/query             → 搜索 runs（session 必须是 UUID 数组）
// GET  /runs/:id               → 单条 run 详情
// ────────────────────────────────────────────────────────

const LS_BASE = 'https://api.smith.langchain.com'
const LS_KEY  = process.env.LANGSMITH_API_KEY ?? ''
const LS_PROJ = process.env.LANGCHAIN_PROJECT  ?? 'MCP_SERVER_TEMPLEATE'

if (!LS_KEY && typeof window === 'undefined') {
  console.warn('[LangSmith] LANGSMITH_API_KEY 未设置，TracePanel 将无法工作')
}

// ── GET 封装 ──────────────────────────────────────────
async function lsFetch(path, params = {}) {
  if (!LS_KEY) throw new Error('LANGSMITH_API_KEY 未配置')
  const url = new URL(`${LS_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  })
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'x-api-key': LS_KEY },
    cache: 'no-store',
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`LangSmith API ${res.status}: ${t}`) }
  return res.json()
}

// ── POST 封装 ─────────────────────────────────────────
async function lsPost(path, body = {}) {
  if (!LS_KEY) throw new Error('LANGSMITH_API_KEY 未配置')
  const res = await fetch(`${LS_BASE}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': LS_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`LangSmith API ${res.status}: ${t}`) }
  return res.json()
}

// ── Session ID 缓存 ───────────────────────────────────
let _sessionIdCache = null

async function getSessionId() {
  if (_sessionIdCache) return _sessionIdCache
  const data = await lsFetch('/sessions', { name: LS_PROJ })
  const session = Array.isArray(data) ? data[0] : data
  if (!session?.id) throw new Error(`LangSmith：找不到项目 "${LS_PROJ}"`)
  _sessionIdCache = session.id
  return _sessionIdCache
}

// ── 主要接口 ──────────────────────────────────────────

/**
 * 获取 Run 列表
 * @returns {{ runs, cursor, project }}
 */
export async function listRuns({ limit = 20, filter, cursor } = {}) {
  const sessionId = await getSessionId()
  const body = {
    session:  [sessionId],
    limit,
    is_root:  true,
    order_by: 'start_time',
  }
  if (filter) body.filter = filter
  if (cursor) body.cursor = cursor

  const data = await lsPost('/runs/query', body)
  const list = Array.isArray(data) ? data : (data.runs ?? [])

  return {
    runs:    list.map(normalizeRun),
    cursor:  data.cursor ?? null,
    project: LS_PROJ,              // ← 新增：传给前端展示项目名
  }
}

/** 获取单条 Run 的完整详情 */
export async function getRun(runId) {
  const run = await lsFetch(`/runs/${runId}`)
  return normalizeRun(run, true)
}

/** 获取某条 Run 的子 Run */
export async function getChildRuns(parentRunId) {
  const sessionId = await getSessionId()
  const data = await lsPost('/runs/query', {
    session:       [sessionId],
    parent_run_id: parentRunId,
    limit:         50,
  })
  const list = Array.isArray(data) ? data : (data.runs ?? [])
  return list.map(r => normalizeRun(r, true))
}

// ── 标准化 ────────────────────────────────────────────
function normalizeRun(r, full = false) {
  const base = {
    id:             r.id,
    name:           r.name     ?? '—',
    run_type:       r.run_type ?? 'unknown',
    status:         r.status   ?? 'unknown',
    start_time:     r.start_time,
    end_time:       r.end_time ?? null,
    latency_ms:     calcLatency(r),
    token_usage:    extractTokens(r),
    error:          r.error    ?? null,
    ls_url:         runUrl(r),
    // ← 新增：供列表行直接展示的预览（LangSmith 原生字段 or 自动提取）
    input_preview:  r.inputs_preview  ?? extractPreview(r.inputs,  80),
    output_preview: r.outputs_preview ?? extractPreview(r.outputs, 80),
  }
  if (full) {
    base.inputs  = r.inputs  ?? {}
    base.outputs = r.outputs ?? {}
  }
  return base
}

// 从 inputs/outputs 对象里提取可读摘要
function extractPreview(obj, maxLen = 80) {
  if (!obj) return null
  // LangGraph message 格式：{ messages: [{type, content}] }
  const msgs = obj.messages ?? obj.input?.messages ?? obj.output?.messages
  if (Array.isArray(msgs) && msgs.length > 0) {
    const last = msgs[msgs.length - 1]
    const text = last?.content ?? last?.text ?? ''
    if (text) return trunc(typeof text === 'string' ? text : JSON.stringify(text), maxLen)
  }
  // 简单字符串字段
  for (const key of ['input', 'output', 'question', 'answer', 'text']) {
    if (typeof obj[key] === 'string') return trunc(obj[key], maxLen)
  }
  // fallback JSON
  return trunc(JSON.stringify(obj), maxLen)
}

function trunc(str, max) {
  if (!str) return null
  const s = str.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function calcLatency(r) {
  if (!r.start_time) return null
  const end = r.end_time ?? new Date().toISOString()
  return Math.round(new Date(end).getTime() - new Date(r.start_time).getTime())
}

function extractTokens(r) {
  const hasTopLevel = r.total_tokens != null || r.prompt_tokens != null
  if (!hasTopLevel && !r.token_usage) return null
  const tu = r.token_usage ?? {}
  return {
    total:      r.total_tokens      ?? tu.total_tokens      ?? 0,
    prompt:     r.prompt_tokens     ?? tu.prompt_tokens     ?? 0,
    completion: r.completion_tokens ?? tu.completion_tokens ?? 0,
  }
}

function runUrl(r) {
  const proj = encodeURIComponent(LS_PROJ)
  return `https://smith.langchain.com/o/default/projects/p/${proj}/r/${r.id}`
}