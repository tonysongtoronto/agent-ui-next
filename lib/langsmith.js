// lib/langsmith.js
// ────────────────────────────────────────────────────────
// LangSmith REST API 封装（Next.js 服务端专用）
//
// 正确的调用链（已通过 PowerShell 验证）：
//   GET  /sessions?name=<name>   → 拿 session UUID
//   POST /runs/query             → 搜索 runs（session 必须是 UUID 数组）
//   GET  /runs/:id               → 单条 run 详情
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
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v))
    }
  })

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'x-api-key': LS_KEY },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LangSmith API ${res.status}: ${text}`)
  }
  return res.json()
}

// ── POST 封装 ─────────────────────────────────────────

async function lsPost(path, body = {}) {
  if (!LS_KEY) throw new Error('LANGSMITH_API_KEY 未配置')

  const res = await fetch(`${LS_BASE}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key':    LS_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LangSmith API ${res.status}: ${text}`)
  }
  return res.json()
}

// ── Session ID 缓存 ───────────────────────────────────

let _sessionIdCache = null

/**
 * GET /sessions?name=<name> 查 session UUID
 * 已验证可用，返回对象里有 .id 字段
 */
async function getSessionId() {
  if (_sessionIdCache) return _sessionIdCache

  const data = await lsFetch('/sessions', { name: LS_PROJ })

  // 返回值可能是单对象或数组
  const session = Array.isArray(data) ? data[0] : data

  if (!session?.id) {
    throw new Error(`LangSmith：找不到项目 "${LS_PROJ}"，请确认 LANGCHAIN_PROJECT 配置正确`)
  }

  _sessionIdCache = session.id
  return _sessionIdCache
}

// ── 主要接口 ──────────────────────────────────────────

/**
 * 获取 Run 列表
 * @param {object} opts
 * @param {number}  opts.limit   - 最多返回几条（默认 20）
 * @param {string}  opts.filter  - LangSmith 过滤语法
 * @param {string}  opts.cursor  - 分页游标
 * @returns {{ runs: Run[], cursor?: string }}
 */
export async function listRuns({ limit = 20, filter, cursor } = {}) {
  const sessionId = await getSessionId()

  const body = {
    session:  [sessionId],   // ← 必须是数组！传字符串会 400
    limit,
    is_root:  true,
    order_by: 'start_time',
  }
  if (filter) body.filter = filter
  if (cursor) body.cursor = cursor

  const data = await lsPost('/runs/query', body)

  const list = Array.isArray(data) ? data : (data.runs ?? [])
  const runs = list.map(normalizeRun)

  return {
    runs,
    cursor: data.cursor ?? null,
  }
}

/**
 * 获取单条 Run 的完整详情
 * @param {string} runId
 */
export async function getRun(runId) {
  const run = await lsFetch(`/runs/${runId}`)
  return normalizeRun(run, true)
}

/**
 * 获取某条 Run 的子 Run（工具调用、LLM 调用等）
 * @param {string} parentRunId
 */
export async function getChildRuns(parentRunId) {
  const sessionId = await getSessionId()

  const data = await lsPost('/runs/query', {
    session:       [sessionId],   // ← 数组
    parent_run_id: parentRunId,
    limit:         50,
  })

  const list = Array.isArray(data) ? data : (data.runs ?? [])
  return list.map(r => normalizeRun(r, true))
}

// ── 标准化 ────────────────────────────────────────────

function normalizeRun(r, full = false) {
  const base = {
    id:          r.id,
    name:        r.name     ?? '—',
    run_type:    r.run_type ?? 'unknown',  // chain | llm | tool
    status:      r.status   ?? 'unknown',  // success | error | pending
    start_time:  r.start_time,
    end_time:    r.end_time ?? null,
    latency_ms:  calcLatency(r),
    token_usage: extractTokens(r),
    error:       r.error    ?? null,
    ls_url:      runUrl(r),
  }

  if (full) {
    base.inputs  = r.inputs  ?? {}
    base.outputs = r.outputs ?? {}
  }

  return base
}

function calcLatency(r) {
  if (!r.start_time) return null
  const end = r.end_time ?? new Date().toISOString()
  return Math.round(
    new Date(end).getTime() - new Date(r.start_time).getTime()
  )
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