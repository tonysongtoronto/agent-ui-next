'use client'
// components/TracePanel.jsx
// LangSmith 可观测性面板
// 展示每次 agent 执行的运行记录、耗时、token 用量、工具调用链路

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ExternalLink, ChevronDown, ChevronRight,
         Clock, Zap, AlertCircle, CheckCircle, Loader,
         Activity, Terminal, Brain } from 'lucide-react'
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
  success: <CheckCircle  size={13} color="var(--ok)"  />,
  error:   <AlertCircle  size={13} color="var(--err)" />,
  pending: <Loader       size={13} color="var(--warn)" style={{ animation:'spin .8s linear infinite' }} />,
}

// ── 子组件：Run 行 ──────────────────────────────────
function RunRow({ run, onExpand, expanded }) {
  const dur   = run.latency_ms != null ? fmtMs(run.latency_ms)  : '—'
  const tok   = run.token_usage?.total ?? null
  const typeC = RUN_TYPE_COLOR[run.run_type] ?? 'var(--sub)'

  return (
    <div style={sR.row} className="fade-in">
      {/* 展开按钮 */}
      <button onClick={onExpand} style={sR.expandBtn}>
        {expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
      </button>

      {/* 状态 */}
      <span style={sR.statusIcon}>{STATUS_ICON[run.status] ?? STATUS_ICON.pending}</span>

      {/* 类型徽章 */}
      <span style={{ ...sR.typeBadge, color: typeC, borderColor: typeC + '44', background: typeC + '11' }}>
        {RUN_TYPE_ICON[run.run_type]}
        {run.run_type}
      </span>

      {/* 名称 */}
      <span style={sR.name} title={run.name}>{run.name}</span>

      {/* 时间 */}
      <span style={sR.meta}>
        <Clock size={10} style={{ marginRight:3 }}/>
        {run.start_time ? new Date(run.start_time).toLocaleTimeString() : '—'}
      </span>

      {/* 耗时 */}
      <span style={sR.meta}>
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

// ── 子组件：展开详情 ────────────────────────────────
function RunDetail({ runId }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    setLoading(true)
    apiGetTrace(runId)
      .then(d => { setDetail(d); setLoading(false) })
      .catch(e => { setErr(e.message); setLoading(false) })
  }, [runId])

  if (loading) return <div style={sD.wrap}><span style={sD.hint}>加载中…</span></div>
  if (err)     return <div style={sD.wrap}><span style={{ color:'var(--err)', fontFamily:'var(--mono)', fontSize:12 }}>{err}</span></div>
  if (!detail) return null

  const { run, children = [] } = detail

  return (
    <div style={sD.wrap}>
      {/* Inputs / Outputs */}
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
        <div style={{ ...sD.section, borderColor: 'rgba(248,113,113,.3)', background: 'rgba(248,113,113,.06)' }}>
          <div style={{ ...sD.sectionTitle, color:'var(--err)' }}>Error</div>
          <pre style={{ ...sD.pre, color:'var(--err)' }}>{run.error}</pre>
        </div>
      )}

      {/* Child runs */}
      {children.length > 0 && (
        <div style={sD.section}>
          <div style={sD.sectionTitle}>执行链路（{children.length} 步）</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:6 }}>
            {children.map((c, i) => (
              <div key={c.id} style={sD.childRow}>
                <span style={{ color:'var(--border2)', fontFamily:'var(--mono)', fontSize:10, flexShrink:0 }}>
                  {String(i+1).padStart(2,'0')}
                </span>
                <span style={{
                  ...sD.childType,
                  color: RUN_TYPE_COLOR[c.run_type] ?? 'var(--sub)',
                }}>{c.run_type}</span>
                <span style={sD.childName}>{c.name}</span>
                <span style={sD.childMs}>{c.latency_ms != null ? fmtMs(c.latency_ms) : '—'}</span>
                {c.token_usage?.total ? (
                  <span style={sD.childTok}>{c.token_usage.total} tok</span>
                ) : null}
                <span style={{ marginLeft:'auto' }}>{STATUS_ICON[c.status] ?? STATUS_ICON.pending}</span>
              </div>
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
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState('')
  const [cursor,   setCursor]   = useState('')
  const [expanded, setExpanded] = useState(null)   // 当前展开的 run id
  const [filter,   setFilter]   = useState('')
  const [limit,    setLimit]    = useState(20)

  const load = useCallback(async (append = false) => {
    setLoading(true); setErr('')
    try {
      const res = await apiListTraces({
        limit,
        filter,
        cursor: append ? cursor : '',
      })
      if (res.error) { setErr(res.error); setLoading(false); return }
      setRuns(prev => append ? [...prev, ...res.runs] : res.runs)
      setCursor(res.cursor ?? '')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [limit, filter, cursor])

  useEffect(() => { load() }, [])   // 首次加载

  const toggleExpand = (id) => setExpanded(prev => prev === id ? null : id)

  const totalTok = runs.reduce((acc, r) => acc + (r.token_usage?.total ?? 0), 0)
  const avgMs    = runs.length
    ? Math.round(runs.filter(r => r.latency_ms).reduce((a,r) => a + r.latency_ms, 0) / runs.filter(r=>r.latency_ms).length)
    : 0

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ── 顶部统计 & 过滤 ───────────────────────── */}
      <div style={s.header}>
        {/* 统计卡 */}
        <div style={s.statRow}>
          <StatChip label="总 Runs" value={runs.length} color="var(--accent)" />
          <StatChip label="总 Token" value={totalTok ? totalTok.toLocaleString() : '—'} color="var(--accent3)" />
          <StatChip label="平均耗时" value={avgMs ? fmtMs(avgMs) : '—'} color="var(--accent2)" />
        </div>

        {/* 过滤 & 刷新 */}
        <div style={s.filterRow}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="过滤（如：eq(status, 'error')）"
            style={s.filterInput}
          />
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={s.select}>
            {[10, 20, 50].map(n => <option key={n} value={n}>{n} 条</option>)}
          </select>
          <button onClick={() => load()} disabled={loading} style={s.refreshBtn}>
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

      {/* ── Run 列表 ──────────────────────────────── */}
      <div style={s.listWrap}>
        {/* 表头 */}
        <div style={s.thead}>
          <span style={{ width:22 }}/>
          <span style={{ width:16 }}/>
          <span style={{ width:54 }}>类型</span>
          <span style={{ flex:1 }}>名称</span>
          <span style={{ width:72 }}>开始</span>
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
              <Loader size={14} style={{ animation:'spin .6s linear infinite' }}/> 加载中…
            </div>
          )}
        </div>

        {/* 加载更多 */}
        {cursor && !loading && (
          <div style={s.loadMore}>
            <button onClick={() => load(true)} style={s.loadMoreBtn}>
              加载更多
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
    <div style={{ ...s.chip, borderColor: color + '33', background: color + '0e' }}>
      <span style={{ fontFamily:'var(--mono)', fontSize:16, fontWeight:700, color }}>{value}</span>
      <span style={{ fontSize:11, color:'var(--sub)', marginTop:1 }}>{label}</span>
    </div>
  )
}

// ── 格式化 ────────────────────────────────────────────
function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`
  return `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`
}

// ── 样式 ──────────────────────────────────────────────
const s = {
  header: {
    padding: '14px 20px', borderBottom:'1px solid var(--border)',
    flexShrink:0, display:'flex', flexDirection:'column', gap:10,
  },
  statRow:  { display:'flex', gap:10 },
  filterRow:{ display:'flex', gap:8, alignItems:'center' },
  chip: {
    display:'flex', flexDirection:'column', alignItems:'center',
    padding:'8px 16px', borderRadius:'var(--r)', border:'1px solid',
    minWidth:80,
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
    flexShrink:0,
  },
  list: { flex:1, overflowY:'auto' },
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
    cursor:'default',
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
    flexShrink:0, width:54,
  },
  name: {
    flex:1, fontFamily:'var(--mono)', fontSize:12, color:'var(--text)',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  meta: {
    fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)',
    display:'flex', alignItems:'center', flexShrink:0,
    width:72, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  extLink: {
    color:'var(--sub)', display:'flex', alignItems:'center',
    textDecoration:'none', padding:3, borderRadius:4,
    transition:'color .15s', flexShrink:0,
  },
}

const sD = {
  wrap: {
    padding:'10px 14px 14px 44px',
    borderBottom:'1px solid var(--border)',
    background:'var(--bg)',
    display:'flex', flexDirection:'column', gap:8,
  },
  hint: { color:'var(--sub)', fontFamily:'var(--mono)', fontSize:12 },
  section: {
    padding:'10px 12px', borderRadius:8,
    border:'1px solid var(--border)', background:'var(--s2)',
  },
  sectionTitle: {
    fontFamily:'var(--mono)', fontSize:10, fontWeight:600,
    color:'var(--sub)', letterSpacing:'.08em', textTransform:'uppercase',
    marginBottom:6,
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
  childType: {
    fontFamily:'var(--mono)', fontSize:10, fontWeight:600,
    width:36, flexShrink:0,
  },
  childName: {
    flex:1, fontFamily:'var(--mono)', fontSize:11.5, color:'var(--text)',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  },
  childMs:  { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', width:48, flexShrink:0 },
  childTok: { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', width:56, flexShrink:0 },
}
