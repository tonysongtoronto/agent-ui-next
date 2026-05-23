'use client'
// components/TracePanel.jsx

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, ExternalLink, ChevronDown, ChevronRight,
         Clock, Zap, AlertCircle, CheckCircle, Loader,
         Activity, Terminal, Brain, FolderOpen } from 'lucide-react'
import { apiListTraces, apiGetTrace } from '../lib/client.js'

// ── 常量 ──────────────────────────────────────────────
const RUN_TYPE_ICON = {
  chain: <Activity size={11} />,
  llm:   <Brain    size={11} />,
  tool:  <Terminal size={11} />,
}
const RUN_TYPE_COLOR = {
  chain: 'var(--accent)',
  llm:   'var(--accent3)',
  tool:  'var(--accent2)',
}
const STATUS_ICON = {
  success: <CheckCircle size={13} color="var(--ok)"  />,
  error:   <AlertCircle size={13} color="var(--err)" />,
  pending: <Loader      size={13} color="var(--warn)" style={{ animation:'spin .8s linear infinite' }} />,
}

// ── 子组件：Run 行 ────────────────────────────────────
function RunRow({ run, onExpand, expanded }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const dur   = run.latency_ms != null ? fmtMs(run.latency_ms) : '—'
  const tok   = run.token_usage?.total ?? null
  const typeC = RUN_TYPE_COLOR[run.run_type] ?? 'var(--sub)'

  const latColor = run.latency_ms > 10000 ? 'var(--err)'
                 : run.latency_ms > 5000  ? 'var(--warn)'
                 : 'var(--ok)'

  return (
    <div style={sR.row} className="fade-in">
      {/* 展开 */}
      <button onClick={onExpand} style={sR.expandBtn}>
        {expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
      </button>

      {/* 状态 */}
      <span style={sR.statusIcon}>{STATUS_ICON[run.status] ?? STATUS_ICON.pending}</span>

      {/* 类型 */}
      <span style={{ ...sR.typeBadge, color: typeC, borderColor: typeC+'44', background: typeC+'11' }}>
        {RUN_TYPE_ICON[run.run_type]}
        {run.run_type}
      </span>

      {/* 名称 */}
      <span style={sR.name} title={run.name}>{run.name}</span>

      {/* Input 预览 */}
      <span style={sR.preview} title={run.input_preview ?? ''}>
        {run.input_preview ?? <span style={{ color:'var(--border2)' }}>—</span>}
      </span>

      {/* Output 预览 */}
      <span style={sR.preview} title={run.output_preview ?? ''}>
        {run.output_preview ?? <span style={{ color:'var(--border2)' }}>—</span>}
      </span>

      {/* 开始时间 */}
      <span style={{ ...sR.meta, width:148 }}>
        <Clock size={10} style={{ marginRight:3 }}/>
        {mounted && run.start_time
          ? new Date(run.start_time).toLocaleString('zh-CN', { timeZone: 'America/Toronto', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })
          : '—'}
      </span>

      {/* 耗时（带颜色） */}
      <span style={{ ...sR.meta, color: latColor }}>
        <Zap size={10} style={{ marginRight:3 }}/>
        {dur}
      </span>

      {/* Token */}
      <span style={sR.meta}>
        {tok != null ? `${tok.toLocaleString()} tok` : '—'}
      </span>

      {/* LangSmith 链接 */}
      <a href={run.ls_url} target="_blank" rel="noreferrer" style={sR.extLink} title="在 LangSmith 查看">
        <ExternalLink size={12}/>
      </a>
    </div>
  )
}

// ── 子组件：可展开的子 Run 行（递归） ────────────────
function ChildRunRow({ child, index, depth = 0 }) {
  const [open,    setOpen]    = useState(false)
  const [detail,  setDetail]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  const typeColor = RUN_TYPE_COLOR[child.run_type] ?? 'var(--sub)'
  const indent    = depth * 16

  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (detail || loading) return
    setLoading(true); setErr('')
    try {
      const d = await apiGetTrace(child.id)
      setDetail(d)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const run      = detail ? (detail.run ?? detail) : null
  const grandkids = detail ? (detail.children ?? []) : []
  const hasInputs  = run?.inputs  && Object.keys(run.inputs).length  > 0
  const hasOutputs = run?.outputs && Object.keys(run.outputs).length > 0
  const hasError   = run?.error

  return (
    <div>
      {/* ── 行本身 ── */}
      <div
        onClick={toggle}
        style={{
          display:'flex', alignItems:'center', gap:8,
          padding:'5px 0', paddingLeft: indent,
          borderBottom:'1px solid var(--border)',
          cursor:'pointer', transition:'background .12s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* 展开箭头 */}
        <span style={{ color:'var(--border2)', flexShrink:0, display:'flex', width:14 }}>
          {open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
        </span>

        {/* 序号 */}
        <span style={{ color:'var(--border2)', fontFamily:'var(--mono)', fontSize:10, flexShrink:0, width:18 }}>
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* 状态 */}
        <span style={{ display:'flex', flexShrink:0 }}>
          {STATUS_ICON[child.status] ?? STATUS_ICON.pending}
        </span>

        {/* 类型徽章 */}
        <span style={{
          display:'inline-flex', alignItems:'center', gap:3,
          padding:'1px 6px', borderRadius:99,
          border:`1px solid ${typeColor}44`, background:`${typeColor}11`,
          fontFamily:'var(--mono)', fontSize:10, fontWeight:600,
          color: typeColor, flexShrink:0, width:52,
        }}>
          {RUN_TYPE_ICON[child.run_type]}
          {child.run_type}
        </span>

        {/* 名称 */}
        <span style={{
          flex:1, fontFamily:'var(--mono)', fontSize:11.5, color:'var(--text)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>
          {child.name}
        </span>

        {/* input 预览 */}
        {child.input_preview && (
          <span style={{
            fontFamily:'var(--mono)', fontSize:10, color:'var(--border2)',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            maxWidth:140, flexShrink:1,
          }} title={child.input_preview}>
            {child.input_preview}
          </span>
        )}

        {/* 耗时 */}
        <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', flexShrink:0, width:48 }}>
          {child.latency_ms != null ? fmtMs(child.latency_ms) : '—'}
        </span>

        {/* Token */}
        {child.token_usage?.total
          ? <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', flexShrink:0, width:56 }}>
              {child.token_usage.total} tok
            </span>
          : null}

        {/* LangSmith 链接 */}
        {child.ls_url && (
          <a
            href={child.ls_url} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color:'var(--sub)', display:'flex', textDecoration:'none', padding:2, borderRadius:4, flexShrink:0 }}
            title="在 LangSmith 查看"
          >
            <ExternalLink size={11}/>
          </a>
        )}
      </div>

      {/* ── 展开内容 ── */}
      {open && (
        <div style={{
          marginLeft: indent + 14,
          borderLeft:'2px solid var(--border)',
          paddingLeft:12,
          marginBottom:4,
        }}>
          {loading && (
            <div style={{ padding:'6px 0', color:'var(--sub)', fontFamily:'var(--mono)', fontSize:12, display:'flex', alignItems:'center', gap:6 }}>
              <Loader size={12} style={{ animation:'spin .6s linear infinite' }}/> 加载中…
            </div>
          )}
          {err && (
            <div style={{ padding:'6px 0', color:'var(--err)', fontFamily:'var(--mono)', fontSize:11 }}>
              {err}
            </div>
          )}

          {/* Inputs */}
          {hasInputs && (
            <div style={{ ...sD.section, marginTop:6 }}>
              <div style={sD.sectionTitle}>Inputs</div>
              <pre style={sD.pre}>{JSON.stringify(run.inputs, null, 2)}</pre>
            </div>
          )}

          {/* Outputs */}
          {hasOutputs && (
            <div style={{ ...sD.section, marginTop:6 }}>
              <div style={sD.sectionTitle}>Outputs</div>
              <pre style={sD.pre}>{JSON.stringify(run.outputs, null, 2)}</pre>
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div style={{ ...sD.section, marginTop:6, borderColor:'rgba(248,113,113,.3)', background:'rgba(248,113,113,.06)' }}>
              <div style={{ ...sD.sectionTitle, color:'var(--err)' }}>Error</div>
              <pre style={{ ...sD.pre, color:'var(--err)' }}>{run.error}</pre>
            </div>
          )}

          {/* 孙子链路（递归） */}
          {grandkids.length > 0 && (
            <div style={{ ...sD.section, marginTop:6 }}>
              <div style={sD.sectionTitle}>子链路（{grandkids.length} 步）</div>
              <div style={{ display:'flex', flexDirection:'column', gap:0, marginTop:6 }}>
                {grandkids.map((gc, i) => (
                  <ChildRunRow key={gc.id} child={gc} index={i} depth={depth + 1} />
                ))}
              </div>
            </div>
          )}

          {/* 无内容提示 */}
          {!loading && !err && !hasInputs && !hasOutputs && !hasError && grandkids.length === 0 && (
            <div style={{ padding:'6px 0', color:'var(--border2)', fontFamily:'var(--mono)', fontSize:11 }}>
              无详细数据
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 子组件：展开详情 ──────────────────────────────────
function RunDetail({ runId }) {
  const [detail,  setDetail]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')

  useEffect(() => {
    setLoading(true)
    setErr('')
    setDetail(null)
    apiGetTrace(runId)
      .then(d => { setDetail(d); setLoading(false) })
      .catch(e => { setErr(e.message); setLoading(false) })
  }, [runId])

  if (loading) return <div style={sD.wrap}><span style={sD.hint}>加载中…</span></div>
  if (err)     return <div style={sD.wrap}><span style={{ color:'var(--err)', fontFamily:'var(--mono)', fontSize:12 }}>{err}</span></div>
  if (!detail) return null

  if (detail.error) {
    return (
      <div style={sD.wrap}>
        <span style={{ color:'var(--err)', fontFamily:'var(--mono)', fontSize:12 }}>
          {detail.error}
        </span>
      </div>
    )
  }

  const run      = detail.run ?? detail
  const children = detail.children ?? []

  if (!run) return null

  return (
    <div style={sD.wrap}>
      {run.inputs && Object.keys(run.inputs).length > 0 && (
        <div style={sD.section}>
          <div style={sD.sectionTitle}>Inputs</div>
          <pre style={sD.pre}>{JSON.stringify(run.inputs, null, 2)}</pre>
        </div>
      )}
      {run.outputs && Object.keys(run.outputs).length > 0 && (
        <div style={sD.section}>
          <div style={sD.sectionTitle}>Outputs</div>
          <pre style={sD.pre}>{JSON.stringify(run.outputs, null, 2)}</pre>
        </div>
      )}
      {run.error && (
        <div style={{ ...sD.section, borderColor:'rgba(248,113,113,.3)', background:'rgba(248,113,113,.06)' }}>
          <div style={{ ...sD.sectionTitle, color:'var(--err)' }}>Error</div>
          <pre style={{ ...sD.pre, color:'var(--err)' }}>{run.error} </pre>
        </div>
      )}
      {children.length > 0 && (
        <div style={sD.section}>
          <div style={sD.sectionTitle}>执行链路（{children.length} 步）</div>
          <div style={{ display:'flex', flexDirection:'column', gap:0, marginTop:6 }}>
            {children.map((c, i) => (
              <ChildRunRow key={c.id} child={c} index={i} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────
export default function TracePanel() {
  const [runs,     setRuns]     = useState([])
  const [project,  setProject]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [hasMore,  setHasMore]  = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [filter,   setFilter]   = useState('')
  const [limit,    setLimit]    = useState(20)

  // 所有分页状态全放 ref，彻底避免闭包陷阱
  const cursorRef  = useRef(null)   // start_time ISO string，null = 第一页
  const filterRef  = useRef('')
  const limitRef   = useRef(20)
  const loadingRef = useRef(false)

  const load = useCallback(async (append = false) => {
  
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true); setErr('')

    const cursor = append ? cursorRef.current : null
    if (!append) cursorRef.current = null

    try {
      const res = await apiListTraces({
        limit:  limitRef.current,
        filter: filterRef.current,
        cursor,
      })
      if (res.error) { setErr(res.error); return }
      setRuns(prev => append ? [...prev, ...res.runs] : res.runs)
      cursorRef.current = res.nextCursor ?? null
      setHasMore(res.hasMore ?? false)
      if (res.project) setProject(res.project)
    } catch (e) {
      setErr(e.message)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])   // 永远不重建

  // 初始加载（只跑一次）
  useEffect(() => { load(false) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // 校验是否为合法的 LangSmith filter 语法（必须以函数调用开头）
  const isValidFilter = (val) => {
    if (!val || !val.trim()) return true   // 空 = 不过滤，合法
    return /^\s*(eq|neq|gt|gte|lt|lte|and|or|not|has|search|in|nin|exists)\s*\(/.test(val.trim())
  }

  const handleFilterChange = (val) => {
    setFilter(val)   // 始终更新显示
    // 只有合法语法才更新 ref（ref 决定实际发给 API 的值）
    if (isValidFilter(val)) {
      filterRef.current = val
    }
  }

  const handleLimitChange = (val) => {
    limitRef.current  = val
    cursorRef.current = null
    setLimit(val)
    setHasMore(false)
    load(false)
  }

  const refresh = () => {
    cursorRef.current = null
    setHasMore(false)
    load(false)
  }

  const toggleExpand = id => setExpanded(prev => prev === id ? null : id)

  const totalTok  = runs.reduce((acc, r) => acc + (r.token_usage?.total ?? 0), 0)
  const validRuns = runs.filter(r => r.latency_ms)
  const avgMs     = validRuns.length
    ? Math.round(validRuns.reduce((a, r) => a + r.latency_ms, 0) / validRuns.length)
    : 0
  const errorCnt  = runs.filter(r => r.status === 'error').length

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ── 顶部：项目名 + 统计 + 过滤 ─────────────── */}
      <div style={s.header}>

        {/* 项目名 */}
        {project && (
          <div style={s.projectBar}>
            <FolderOpen size={13} style={{ color:'var(--accent)', flexShrink:0 }}/>
            <span style={s.projectName}>{project}</span>
            <span style={s.projectSub}>LangSmith 运行记录 · Token 用量 · 执行链路</span>
          </div>
        )}

        {/* 统计卡 */}
        <div style={s.statRow}>
          <StatChip label="总 Runs"  value={runs.length}                          color="var(--accent)"  />
          <StatChip label="总 Token" value={totalTok ? totalTok.toLocaleString() : '—'} color="var(--accent3)" />
          <StatChip label="平均耗时" value={avgMs ? fmtMs(avgMs) : '—'}           color="var(--accent2)" />
          {errorCnt > 0 && (
            <StatChip label="错误"   value={errorCnt}                             color="var(--err)"     />
          )}
        </div>

        {/* 过滤 & 刷新 */}
        <div style={s.filterRow}>
          <input
            value={filter}
            onChange={e => handleFilterChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && isValidFilter(filter) && refresh()}
            placeholder="过滤语法：eq(status,'error') / gt(latency,5000)"
            autoComplete="off"
            style={{
              ...s.filterInput,
              borderColor: filter && !isValidFilter(filter) ? 'var(--err)' : undefined,
            }}
          />
          <select value={limit} onChange={e => handleLimitChange(Number(e.target.value))} style={s.select}>
            {[1,3,5,10, 20, 50].map(n => <option key={n} value={n}>{n} 条</option>)}
          </select>
          <button onClick={refresh} disabled={loading} style={s.refreshBtn}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin .6s linear infinite' : 'none' }}/>
            刷新
          </button>
        </div>
      </div>

      {/* ── 错误提示 ──────────────────────────────── */}
      {err && (
        <div style={s.errBox}>
          <AlertCircle size={13}/> {err}
          {err.includes('未配置') && (
            <span style={{ display:'block', marginTop:6, fontSize:11 }}>
              请在 .env.local 里添加：LANGSMITH_API_KEY=lsv2_pt_...
            </span>
          )}
        </div>
      )}

      {/* ── Run 列表（横向可滚动） ─────────────────── */}
      <div style={s.listWrap}>
        {/* 表头 */}
        <div style={s.thead}>
          <span style={{ width:22 }}/>
          <span style={{ width:16 }}/>
          <span style={{ width:60 }}>类型</span>
          <span style={{ width:100 }}>名称</span>
          <span style={{ flex:'1 1 160px', minWidth:120 }}>Input</span>
          <span style={{ flex:'1 1 160px', minWidth:120 }}>Output</span>
          <span style={{ width:148 }}>开始时间</span>
          <span style={{ width:60 }}>耗时</span>
          <span style={{ width:72 }}>Token</span>
          <span style={{ width:20 }}/>
        </div>

        <div style={s.list}>
          {runs.length === 0 && !loading && (
            <div style={s.empty}>
              {err ? '加载失败' : 'LangSmith 暂无运行记录，先在 Chat 面板发一条消息试试。'}
            </div>
          )}

          {runs.map(run => (
            <div key={run.id}>
              <RunRow
                run={run}
                expanded={expanded === run.id}
                onExpand={() => toggleExpand(run.id)}
              />
              {expanded === run.id && <RunDetail runId={run.id} />}
            </div>
          ))}

          {loading && (
            <div style={s.loadingRow}>
              <Loader size={14} style={{ animation:'spin .6s linear infinite' }}/> 加载中
            </div>
          )}
        </div>

        {/* ── 加载更多按钮 —— 用 hasMore 判断，不再用 cursor ── */}
        {hasMore && !loading && (
          <div style={s.loadMore}>
            <button onClick={() => load(true)} style={s.loadMoreBtn}>
              加载更多（已显示 {runs.length} 条）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 工具组件 ──────────────────────────────────────────
function StatChip({ label, value, color }) {
  return (
    <div style={{ ...s.chip, borderColor: color+'33', background: color+'0e' }}>
      <span style={{ fontFamily:'var(--mono)', fontSize:16, fontWeight:700, color }}>{value}</span>
      <span style={{ fontSize:11, color:'var(--sub)', marginTop:1 }}>{label}</span>
    </div>
  )
}

// ── 工具函数 ──────────────────────────────────────────
function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`
  return `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`
}

function trunc(str, max) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + '…' : str
}

// ── 样式 ──────────────────────────────────────────────
const s = {
  header: {
    padding:'12px 20px', borderBottom:'1px solid var(--border)',
    flexShrink:0, display:'flex', flexDirection:'column', gap:10,
  },
  projectBar: {
    display:'flex', alignItems:'center', gap:8,
    paddingBottom:8, borderBottom:'1px solid var(--border)',
  },
  projectName: {
    fontFamily:'var(--mono)', fontSize:13, fontWeight:700,
    color:'var(--text)', letterSpacing:'.03em',
  },
  projectSub: {
    fontSize:11, color:'var(--sub)', marginLeft:4,
  },
  statRow:   { display:'flex', gap:10 },
  filterRow: { display:'flex', gap:8, alignItems:'center' },
  chip: {
    display:'flex', flexDirection:'column', alignItems:'center',
    padding:'8px 16px', borderRadius:'var(--r)', border:'1px solid', minWidth:80,
  },
  filterInput: {
    flex:1, padding:'6px 12px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12, outline:'none',
  },
  select: {
    padding:'6px 10px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--sub)', fontSize:12, outline:'none', cursor:'pointer',
  },
  refreshBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'6px 14px',
    background:'var(--s2)', border:'1px solid var(--border)',
    borderRadius:8, color:'var(--sub)', cursor:'pointer', fontSize:12,
    fontFamily:'var(--sans)', whiteSpace:'nowrap',
  },
  errBox: {
    margin:'12px 20px', padding:'10px 14px',
    background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.25)',
    borderRadius:'var(--r)', color:'var(--err)',
    fontSize:12.5, fontFamily:'var(--mono)',
    display:'flex', flexDirection:'column', gap:4,
  },
  listWrap: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  thead: {
    display:'flex', alignItems:'center', gap:8,
    padding:'6px 14px', borderBottom:'1px solid var(--border)',
    fontFamily:'var(--mono)', fontSize:10, fontWeight:600,
    color:'var(--border2)', letterSpacing:'.06em', textTransform:'uppercase',
    flexShrink:0, minWidth:900, overflowX:'auto',
  },
  list:  { flex:1, overflowY:'auto', overflowX:'auto' },
  empty: {
    padding:'40px 20px', textAlign:'center',
    color:'var(--sub)', fontFamily:'var(--mono)', fontSize:13, lineHeight:1.8,
  },
  loadingRow: {
    display:'flex', alignItems:'center', gap:8, padding:'14px 20px',
    color:'var(--sub)', fontSize:13, fontFamily:'var(--mono)',
  },
  loadMore: { padding:'12px 20px', borderTop:'1px solid var(--border)', flexShrink:0 },
  loadMoreBtn: {
    width:'100%', padding:'8px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--sub)', cursor:'pointer', fontSize:13, fontFamily:'var(--sans)',
  },
}

const sR = {
  row: {
    display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
    borderBottom:'1px solid var(--border)', transition:'background .15s',
    cursor:'default', minWidth:900,
  },
  expandBtn: {
    padding:2, background:'none', border:'none',
    color:'var(--sub)', cursor:'pointer', display:'flex',
    borderRadius:4, flexShrink:0, width:22,
  },
  statusIcon: { display:'flex', flexShrink:0, width:16 },
  typeBadge: {
    display:'inline-flex', alignItems:'center', gap:3,
    padding:'2px 7px', borderRadius:99, border:'1px solid',
    fontFamily:'var(--mono)', fontSize:10, fontWeight:600,
    flexShrink:0, width:60,
  },
  name: {
    fontFamily:'var(--mono)', fontSize:12, color:'var(--text)',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
    width:100, flexShrink:0,
  },
  preview: {
    flex:'1 1 160px', minWidth:120,
    fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  errorCell: {
    width:110, flexShrink:0,
    fontFamily:'var(--mono)', fontSize:11,
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
    display:'flex', alignItems:'center',
  },
  meta: {
    fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)',
    display:'flex', alignItems:'center', flexShrink:0,
    width:80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  extLink: {
    color:'var(--sub)', display:'flex', alignItems:'center',
    textDecoration:'none', padding:3, borderRadius:4,
    transition:'color .15s', flexShrink:0,
  },
}

const sD = {
  wrap: {
    padding:'10px 14px 14px 44px', borderBottom:'1px solid var(--border)',
    background:'var(--bg)', display:'flex', flexDirection:'column', gap:8,
  },
  hint: { color:'var(--sub)', fontFamily:'var(--mono)', fontSize:12 },
  section: {
    padding:'10px 12px', borderRadius:8,
    border:'1px solid var(--border)', background:'var(--s2)',
  },
  sectionTitle: {
    fontFamily:'var(--mono)', fontSize:10, fontWeight:600,
    color:'var(--sub)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:6,
  },
  pre: {
    fontFamily:'var(--mono)', fontSize:11.5, color:'var(--text)',
    whiteSpace:'pre-wrap', wordBreak:'break-all', lineHeight:1.6,
    maxHeight:200, overflowY:'auto',
  },
  childRow: {
    display:'flex', alignItems:'center', gap:8, padding:'5px 0',
    borderBottom:'1px solid var(--border)',
  },
  childType: { fontFamily:'var(--mono)', fontSize:10, fontWeight:600, width:36, flexShrink:0 },
  childName: {
    flex:1, fontFamily:'var(--mono)', fontSize:11.5, color:'var(--text)',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  childMs:  { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', width:48, flexShrink:0 },
  childTok: { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', width:56, flexShrink:0 },
}