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

// ── 429 重试工具 ──────────────────────────────────────
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fn()
    if (res.status !== 429) return res
    if (attempt === maxRetries) return res
    const retryAfter = Number(res.headers.get('Retry-After') ?? 2)
    const waitMs     = Math.min(retryAfter * 1000, 8000)
    console.warn(`[LangSmith] 429 限流，${waitMs}ms 后重试（第 ${attempt + 1} 次）`)
    await new Promise(r => setTimeout(r, waitMs))
  }
}

// ── GET 封装 ──────────────────────────────────────────
async function lsFetch(path, params = {}) {
  if (!LS_KEY) throw new Error('LANGSMITH_API_KEY 未配置')
  const url = new URL(`${LS_BASE}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  })
  const res = await withRetry(() =>
    fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-api-key': LS_KEY },
      cache: 'no-store',
    })
  )
  if (!res.ok) { const t = await res.text(); throw new Error(`LangSmith API ${res.status}: ${t}`) }
  return res.json()
}

// ── POST 封装 ─────────────────────────────────────────
async function lsPost(path, body = {}) {
  if (!LS_KEY) throw new Error('LANGSMITH_API_KEY 未配置')
  const res = await withRetry(() =>
    fetch(`${LS_BASE}${path}`, {
      method: 'POST',
      headers: { 'x-api-key': LS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  )
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

// ── 详情缓存（内存，进程级，TTL 5 分钟）──────────────
const _runCache      = new Map()
const _childrenCache = new Map()
const CACHE_TTL_MS   = 5 * 60 * 1000

function cacheGet(map, key) {
  const entry = map.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) { map.delete(key); return null }
  return entry.data
}
function cacheSet(map, key, data) {
  map.set(key, { data, ts: Date.now() })
}

// ── 主要接口 ──────────────────────────────────────────

/**
 * 获取 Run 列表（offset 分页）
 * /runs/query 不返回 cursor 字段，使用 offset 翻页
 * @returns {{ runs, hasMore, nextOffset, project }}
 */
export async function listRuns({ limit = 20, filter, offset = 0 } = {}) {
  const sessionId = await getSessionId()
  const body = {
    session:  [sessionId],
    limit,
    offset,           // ← offset 分页，不用 cursor
    is_root:  true,
    order_by: 'start_time',
  }
  if (filter) body.filter = filter

  const data = await lsPost('/runs/query', body)
  const list = Array.isArray(data) ? data : (data.runs ?? [])

  console.log(`[LangSmith] offset=${offset} limit=${limit} got=${list.length}`)

  return {
    runs:       list.map(normalizeRun),
    hasMore:    list.length === limit,   // 返回满 limit 条 → 还有更多
    nextOffset: offset + list.length,    // 下次从这里开始
    project:    LS_PROJ,
  }
}

/** 获取单条 Run 的完整详情（带缓存） */
export async function getRun(runId) {
  const cached = cacheGet(_runCache, runId)
  if (cached) return cached
  const run = await lsFetch(`/runs/${runId}`)
  const result = normalizeRun(run, true)
  cacheSet(_runCache, runId, result)
  return result
}

/** 获取某条 Run 的子 Run（带缓存） */
export async function getChildRuns(parentRunId) {
  const cached = cacheGet(_childrenCache, parentRunId)
  if (cached) return cached
  const sessionId = await getSessionId()
  const data = await lsPost('/runs/query', {
    session: [sessionId],
    filter:  `eq(parent_run_id, "${parentRunId}")`,
    limit:   100,
  })
  const list = Array.isArray(data) ? data : (data.runs ?? [])
  const result = list
    .map(r => normalizeRun(r, true))
    .sort((a, b) => {
      if (!a.start_time) return 1
      if (!b.start_time) return -1
      return new Date(a.start_time) - new Date(b.start_time)
    })
  cacheSet(_childrenCache, parentRunId, result)
  return result
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
    input_preview:  r.inputs_preview  ?? extractPreview(r.inputs,  80),
    output_preview: r.outputs_preview ?? extractPreview(r.outputs, 80),
  }
  if (full) {
    base.inputs  = r.inputs  ?? {}
    base.outputs = r.outputs ?? {}
  }
  return base
}

function extractPreview(obj, maxLen = 80) {
  if (!obj) return null
  const msgs = obj.messages ?? obj.input?.messages ?? obj.output?.messages
  if (Array.isArray(msgs) && msgs.length > 0) {
    const last = msgs[msgs.length - 1]
    const text = last?.content ?? last?.text ?? ''
    if (text) return trunc(typeof text === 'string' ? text : JSON.stringify(text), maxLen)
  }
  for (const key of ['input', 'output', 'question', 'answer', 'text']) {
    if (typeof obj[key] === 'string') return trunc(obj[key], maxLen)
  }
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