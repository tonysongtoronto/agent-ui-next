//
// 消费上一轮打通的两组接口：
//   GET /api/guardrail/rules              规则类别 + 启用状态
//   PUT /api/guardrail/rules/{category}    切换某条规则的启用/禁用
//   GET /api/guardrail/events              判定/审批事件流水（可按
//                                           user_id/thread_id/stage 过滤）
//
// 两个 Tab：
//   规则管理 —— 列出全部规则类别，点开关直接调用 PUT 接口热切换
//              （后端立即生效，不需要重启服务）。
//   审计日志 —— 按条件查询 guardrail_events 表，看"什么时候、哪句话/哪个
//              操作、命中了什么规则、最后是放行/脱敏/被拦/人工批准还是拒绝"。
//
// 数据源本身跟 Chat/Batch/MultiTurn/人工审核 四个面板完全独立（那四个是
// "处理正在发生的中断"，这个页面是"回顾历史判定记录 + 调整规则配置"），
// 所以做成单独一个页面，而不是塞进人工审核页——语义上是两件不同的事：
// 人工审核页面处理的是"当前卡住、需要你现在做决定的事项"，这个页面是
// "已经发生过的、纯只读回顾 + 全局规则配置"。
// ────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, ToggleLeft, ToggleRight, ShieldCheck, ShieldOff,
  FileSearch, SlidersHorizontal, AlertTriangle,
} from 'lucide-react'
import { apiGetGuardrailRules, apiSetGuardrailRule, apiGetGuardrailEvents } from '../lib/client.js'
import { stageMeta, actionMeta, riskTypeLabel, TONE_COLOR } from '../lib/guardrail.js'

const STAGE_OPTIONS = [
  { value: '', label: '全部阶段' },
  { value: 'input', label: '输入侧' },
  { value: 'exec', label: '执行侧' },
  { value: 'output', label: '输出侧' },
  { value: 'decision', label: '人工决策' },
]

function Tag({ tone, children }) {
  const color = TONE_COLOR[tone] || TONE_COLOR.sub
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color,
      background: `${color}1a`, border: `1px solid ${color}40`,
      borderRadius: 99, padding: '2px 9px', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

// ── 规则管理 Tab ──────────────────────────────────────────
function RulesTab() {
  const [rules, setRules]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [toggling, setToggling] = useState(() => new Set())

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await apiGetGuardrailRules()
       console.debug('[TaskReviewPanel] submit payload:', JSON.stringify(data, null, 2))
      setRules(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.message || '加载规则列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect -- 挂载时拉取规则列表，属于合法的数据加载模式

  const toggle = async (category, current) => {
    setToggling(prev => new Set(prev).add(category))
    // 乐观更新：先在界面上翻转，请求失败再翻回去，避免每次点击都要等一圈网络
    // 往返才有反馈——规则开关是频繁小动作，乐观更新体验明显更顺
    setRules(prev => prev.map(r => r.category === category ? { ...r, enabled: !current } : r))

    await new Promise(resolve => setTimeout(resolve, 2000))
    try {
      await apiSetGuardrailRule(category, !current)
    } catch (e) {
      setRules(prev => prev.map(r => r.category === category ? { ...r, enabled: current } : r)) // 回滚
      setError(`切换「${category}」失败：${e.message || '未知错误'}`)
    } finally {
      setToggling(prev => { const c = new Set(prev); c.delete(category); return c })
    }
  }

  return (
    <div style={s.body}>
      {error && <div style={s.errorBox}>{error}</div>}

      {loading && !rules && (
        <div style={s.empty}>
          <RefreshCw size={22} color="var(--sub)" style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 10, fontFamily: 'var(--mono)', color: 'var(--sub)', fontSize: 13 }}>加载规则列表…</div>
        </div>
      )}

      {rules && rules.length === 0 && !loading && (
        <div style={s.empty}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🛡️</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--sub)', fontSize: 13 }}>暂无规则数据</div>
        </div>
      )}

      {rules && rules.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            规则类别（{rules.length}）
            <span style={s.sectionHint}>关闭某条规则后，对应场景不会再触发拦截/记录，立即生效</span>
          </div>
          {rules.map(r => {
            const busy = toggling.has(r.category)
            return (
              <div key={r.category} style={{
                ...s.ruleRow,
                borderColor: r.enabled ? 'rgba(52,211,153,.25)' : 'var(--border)',
                opacity: busy ? 0.6 : 1,
              }}>
                <div style={{ flexShrink: 0 }}>
                  {r.enabled
                    ? <ShieldCheck size={18} color="var(--ok)" />
                    : <ShieldOff size={18} color="var(--sub)" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.ruleLabel}>{r.label || r.category}</div>
                  <div style={s.ruleCategory}>
                    {r.category}
                    {r.updated_at && <span style={{ marginLeft: 10, color: 'var(--border2)' }}>最后更新 {r.updated_at}</span>}
                  </div>
                </div>
                <button
                  onClick={() => toggle(r.category, r.enabled)}
                  disabled={busy}
                  style={{
                    ...s.toggleBtn,
                    color: r.enabled ? 'var(--ok)' : 'var(--sub)',
                    cursor: busy ? 'default' : 'pointer',
                  }}
                  title={r.enabled ? '点击禁用这条规则' : '点击启用这条规则'}
                >
                  {r.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                  <span style={{ fontSize: 11.5, fontFamily: 'var(--mono)', fontWeight: 700 }}>
                    {r.enabled ? '已启用' : '已禁用'}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 审计日志 Tab ──────────────────────────────────────────
function EventsTab() {
  const [filters, setFilters] = useState({ user_id: '', thread_id: '', stage: '', limit: 100 })
  const [events, setEvents]   = useState(null)
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const load = useCallback(async (f) => {
    setLoading(true); setError('')
    try {
      const res = await apiGetGuardrailEvents(f)
      console.debug('[TaskReviewPanel] submit payload:', JSON.stringify(res, null, 2))
      setEvents(res.items || [])
      setTotal(res.total ?? (res.items || []).length)
    } catch (e) {
      setError(e.message || '加载审计日志失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- 挂载时按初始 filters 拉取事件列表，属于合法的数据加载模式

  const submitFilters = (e) => {
    e.preventDefault()
    load(filters)
  }

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const c = new Set(prev)
      c.has(id) ? c.delete(id) : c.add(id)
      return c
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <form onSubmit={submitFilters} style={s.filterBar}>
        <span style={s.topLabel}>User ID</span>
        <input value={filters.user_id} onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
          placeholder="不填=全部" style={{ ...s.input, width: 130 }} />
        <span style={s.topLabel}>Thread ID</span>
        <input value={filters.thread_id} onChange={e => setFilters(f => ({ ...f, thread_id: e.target.value }))}
          placeholder="不填=全部" style={{ ...s.input, width: 180 }} />
        <span style={s.topLabel}>阶段</span>
        <select value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))} style={s.select}>
          {STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={s.topLabel}>条数</span>
        <input type="number" min={1} max={500} value={filters.limit}
          onChange={e => setFilters(f => ({ ...f, limit: Number(e.target.value) || 100 }))}
          style={{ ...s.input, width: 70 }} />
        <button type="submit" disabled={loading} style={s.refreshBtn}>
          <FileSearch size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? '查询中…' : '查询'}
        </button>
      </form>

      <div style={s.body}>
        {error && <div style={s.errorBox}>{error}</div>}

        {events && events.length === 0 && !loading && (
          <div style={s.empty}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🗒️</div>
            <div style={{ fontFamily: 'var(--mono)', color: 'var(--sub)', fontSize: 13 }}>
              没有符合条件的审计记录
            </div>
          </div>
        )}

        {events && events.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionTitle}>
              审计记录（{events.length}{total > events.length ? ` / 共 ${total}` : ''}）
              <span style={s.sectionHint}>按时间倒序，点一行展开命中详情</span>
            </div>
            {events.map(ev => {
              const sm = stageMeta(ev.stage)
              const am = actionMeta(ev.action)
              const isOpen = expanded.has(ev.id)
              return (
                <div key={ev.id} style={s.eventRow}>
                  <div style={s.eventRowHead} onClick={() => toggleExpand(ev.id)}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--border2)', minWidth: 132, flexShrink: 0 }}>
                      {ev.ts}
                    </span>
                    <Tag tone={sm.tone}>{sm.label}</Tag>
                    <Tag tone={am.tone}>{am.label}</Tag>
                    {ev.risk_type && (
                      <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {riskTypeLabel(ev.risk_type)}
                      </span>
                    )}
                    {!ev.risk_type && (
                      <span style={{ fontSize: 12, color: 'var(--sub)', flex: 1 }}>—</span>
                    )}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--border2)', flexShrink: 0 }}>
                      {ev.user_id || 'default'} · {ev.thread_id ? ev.thread_id.slice(0, 18) : '—'}
                    </span>
                  </div>
                  {isOpen && (
                    <div style={s.eventDetail}>
                      {ev.task_id != null && (
                        <div style={s.eventDetailRow}>
                          <span style={s.eventDetailKey}>task_id</span>
                          <span>{ev.task_id}{ev.task_id === -1 ? '（输入侧，非真实任务）' : ev.task_id === -2 ? '（输出侧，非真实任务）' : ''}</span>
                        </div>
                      )}
                      {ev.description && (
                        <div style={s.eventDetailRow}>
                          <span style={s.eventDetailKey}>内容</span>
                          <span style={{ whiteSpace: 'pre-wrap' }}>{ev.description}</span>
                        </div>
                      )}
                      {ev.rule_hits?.length > 0 && (
                        <div style={s.eventDetailRow}>
                          <span style={s.eventDetailKey}>规则命中</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {ev.rule_hits.map((h, i) => (
                              <span key={i}>
                                <b style={{ color: 'var(--err)' }}>{riskTypeLabel(h.category)}</b>
                                {h.detail && <span style={{ color: 'var(--sub)' }}> —— {h.detail}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {ev.llm_verdict && (
                        <div style={s.eventDetailRow}>
                          <span style={s.eventDetailKey}>LLM 复核</span>
                          <span>
                            {ev.llm_verdict.risk ? '判定有风险' : '判定无风险'}
                            {ev.llm_verdict.category ? ` · ${ev.llm_verdict.category}` : ''}
                            {ev.llm_verdict.reason ? ` —— ${ev.llm_verdict.reason}` : ''}
                            {ev.llm_verdict.confidence != null ? `（置信度 ${ev.llm_verdict.confidence}）` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 顶层：Tab 切换 ────────────────────────────────────────
export default function GuardrailAdminPanel() {
  const [tab, setTab] = useState('rules')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={s.tabBar}>
        <button onClick={() => setTab('rules')} style={{ ...s.tabBtn, ...(tab === 'rules' ? s.tabBtnActive : {}) }}>
          <SlidersHorizontal size={14} /> 规则管理
        </button>
        <button onClick={() => setTab('events')} style={{ ...s.tabBtn, ...(tab === 'events' ? s.tabBtnActive : {}) }}>
          <FileSearch size={14} /> 审计日志
        </button>
        <span style={s.tabHint}>
          <AlertTriangle size={11} /> 只读回顾 + 全局规则配置，不影响当前正卡在人工审核里的事项
        </span>
      </div>
      {tab === 'rules' ? <RulesTab /> : <EventsTab />}
    </div>
  )
}

const s = {
  tabBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
    borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  tabBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--sub)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--sans)', cursor: 'pointer',
  },
  tabBtnActive: {
    background: 'rgba(91,156,246,.12)', borderColor: 'var(--accent)', color: 'var(--accent)',
  },
  tabHint: {
    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11, color: 'var(--sub)', fontFamily: 'var(--sans)',
  },
  filterBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
    borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap',
  },
  topLabel: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--sub)',
    fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
  },
  input: {
    padding: '5px 10px', background: 'var(--s2)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none',
  },
  select: {
    padding: '5px 10px', background: 'var(--s2)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none',
  },
  refreshBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'var(--accent)',
    border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 600,
    fontFamily: 'var(--sans)', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  body: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', margin: 'auto', textAlign: 'center', padding: 40,
  },
  errorBox: {
    padding: '10px 14px', background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)',
    borderRadius: 8, color: 'var(--err)', fontSize: 13,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle: {
    fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)',
    display: 'flex', alignItems: 'baseline', gap: 10,
  },
  sectionHint: { fontFamily: 'var(--sans)', fontSize: 11.5, fontWeight: 400, color: 'var(--sub)' },

  // 规则行
  ruleRow: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 10,
  },
  ruleLabel: { fontSize: 13, color: 'var(--text)', lineHeight: 1.5 },
  ruleCategory: { fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--sub)', marginTop: 3 },
  toggleBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 8,
    fontFamily: 'var(--sans)', flexShrink: 0,
  },

  // 审计事件行
  eventRow: {
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden',
  },
  eventRowHead: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
  },
  eventDetail: {
    display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px 14px',
    borderTop: '1px solid var(--border)', background: 'var(--s3)', fontSize: 12.5, lineHeight: 1.7,
  },
  eventDetailRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  eventDetailKey: {
    fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--sub)', textTransform: 'uppercase',
    letterSpacing: '.04em', minWidth: 62, flexShrink: 0, paddingTop: 2,
  },
}