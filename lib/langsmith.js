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

// ✅ 修复：动态读取，不在模块顶层固定，避免热重载后 env 不更新
function getCurrentProj() {
  return process.env.LANGCHAIN_PROJECT ?? 'MCP_SERVER_TEMPLATE_QA'
}

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
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`LangSmith API ${res.status}: ${t}`)
  }
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
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`LangSmith API ${res.status}: ${t}`)
  }
  return res.json()
}

// ── Session ID 缓存 ───────────────────────────────────
// ✅ 修复：用 Map 按项目名缓存，切换 env 后自动使用新 key，不会串项目
const _sessionIdCache = new Map()

async function getSessionId() {
  const proj = getCurrentProj()
  if (_sessionIdCache.has(proj)) return _sessionIdCache.get(proj)

  const data = await lsFetch('/sessions', { name: proj })
  const session = Array.isArray(data) ? data[0] : data
  if (!session?.id) throw new Error(`LangSmith：找不到项目 "${proj}"`)


  _sessionIdCache.set(proj, session.id)
  return session.id
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
 * 获取 Run 列表（基于 start_time 的游标分页）
 * /runs/query 不支持 offset，用 lt(start_time, cursor) 翻页
 * ⚠️ 游标字段必须和 order_by 一致：这里排序用 start_time，
 *    所以翻页过滤也必须用 start_time，不能用 id（id 是随机 UUID，
 *    和时间顺序无关，用它做游标会导致翻页错乱：出现重复行 + 漏行）
 * @param cursor  上次最后一条的 start_time（ISO 字符串），首次传 null
 * @returns {{ runs, hasMore, nextCursor, project }}
 */
export async function listRuns({ limit = 20, filter, cursor = null } = {}) {
  const sessionId = await getSessionId()

  let combinedFilter = filter || null
  if (cursor) {
    const cursorFilter = `lt(start_time, "${cursor}")`
    combinedFilter = combinedFilter
      ? `and(${combinedFilter}, ${cursorFilter})`
      : cursorFilter
  }

  const body = {
    session:  [sessionId],
    limit:    limit + 1,   // 多取 1 条用来探测"后面是否还有"，避免 list.length === limit 的 off-by-one 误判
    is_root:  true,
    order_by: 'start_time',
  }
  if (combinedFilter) body.filter = combinedFilter

  const data = await lsPost('/runs/query', body)
  const raw  = Array.isArray(data) ? data : (data.runs ?? [])

  // 多拿到的这 1 条就说明后面确实还有数据；展示时截掉，不算进本页
  const hasMore = raw.length > limit
  const list    = hasMore ? raw.slice(0, limit) : raw

  const nextCursor = list.length > 0 ? list[list.length - 1].start_time : null

  return {
    runs: list.map(normalizeRun),
    hasMore,
    nextCursor,
    project: getCurrentProj(),
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
  const proj = encodeURIComponent(getCurrentProj())
  return `https://smith.langchain.com/o/default/projects/p/${proj}/r/${r.id}`
}