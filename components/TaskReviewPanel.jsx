'use client'
// components/TaskReviewPanel.jsx
// ★ HITL 改动：全新面板 —— 任务计划状态查看 + 人工审核决策 UI
//
// 对应后端（api.py）的三个接口：
//   GET  /session/{user_id}/{thread_id}/state   查询任务计划 + 待办事项
//   POST /session/{user_id}/{thread_id}/resume  批量提交决策，恢复执行
//   POST /session/{user_id}/{thread_id}/abort   放弃中断，终止整个计划
//
// 交互设计（对应之前讨论的方案）：
//   - 待办事项一次性全部展示，用户可以逐条选择动作，最后"一次性提交"，
//     不是一个个来回问（跟后端 human_review_gate 的批量 interrupt 对应）。
//   - 未处理完全部待办事项之前禁止提交（避免漏决策导致的悬空状态）。
//   - 提交后如果又出现了新一批待办事项（比如刚重试的任务又失败了），
//     直接在同一个面板里继续展示，不需要用户手动刷新。

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, AlertTriangle, ShieldAlert, CheckCircle2, XCircle,
  Clock, Ban, PlayCircle, SkipForward, Edit3, Send, OctagonX,
} from 'lucide-react'
import { apiGetTaskPlanState, apiResumeTaskPlan, apiResumeTaskPlanStream, apiAbortTaskPlanStream } from '../lib/client.js'
import { getCurrentThread, setCurrentThread } from '../lib/shared.js'

// ── 状态 → 展示样式映射（跟 langgraph_parallel_agent.py 的 _STATUS_LABELS 对应）──
const STATUS_META = {
  done:              { label: '已完成',        color: 'var(--ok)',     icon: CheckCircle2 },
  skipped:           { label: '已跳过',        color: 'var(--sub)',    icon: SkipForward },
  blocked:           { label: '未执行·被阻塞',  color: 'var(--warn)',   icon: Ban },
  needs_human:       { label: '等待人工处理',   color: 'var(--err)',    icon: AlertTriangle },
  pending_approval:  { label: '等待人工审批',   color: 'var(--warn)',   icon: ShieldAlert },
  pending:           { label: '未执行',        color: 'var(--sub)',    icon: Clock },
  in_progress:       { label: '执行中',        color: 'var(--accent)', icon: PlayCircle },
  failed:            { label: '失败',          color: 'var(--err)',    icon: XCircle },
}

const PLAN_STATUS_META = {
  running:        { label: '执行中',       color: 'var(--accent)' },
  waiting_human:  { label: '等待人工处理', color: 'var(--warn)' },
  completed:      { label: '已完成',       color: 'var(--ok)' },
  aborted:        { label: '已终止',       color: 'var(--err)' },
}

// 不同 reason 下，用户可以选择的动作
const ACTIONS_BY_REASON = {
  needs_human: [
    { value: 'retry',          label: '重试（原样再跑一次）' },
    { value: 'edit_and_retry', label: '修改描述后重试' },
    { value: 'skip',           label: '跳过（不影响其他任务）' },
  ],
  pending_approval: [
    { value: 'approve', label: '批准执行' },
    { value: 'reject',  label: '拒绝（跳过，不执行）' },
  ],
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || '未知', color: 'var(--sub)', icon: Clock }
  const Icon = meta.icon
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11.5, fontFamily: 'var(--mono)', color: meta.color,
      background: `${meta.color}1a`, border: `1px solid ${meta.color}40`,
      borderRadius: 99, padding: '2px 9px', whiteSpace: 'nowrap',
    }}>
      <Icon size={11} />{meta.label}
    </span>
  )
}

function PlanStatusBadge({ status }) {
  const meta = PLAN_STATUS_META[status] || { label: status, color: 'var(--sub)' }
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: meta.color,
      background: `${meta.color}1a`, border: `1px solid ${meta.color}40`,
      borderRadius: 7, padding: '4px 12px',
    }}>
      {meta.label}
    </span>
  )
}

// ── 单个待办事项卡片 ────────────────────────────────────
function GateItemCard({ item, decision, onChange }) {
  const isApproval = item.reason === 'pending_approval'
  const actions = ACTIONS_BY_REASON[item.reason] || ACTIONS_BY_REASON.needs_human
  const action = decision?.action || ''

  return (
    <div style={s.gateCard} className="fade-up">
      <div style={s.gateCardHeader}>
        <span style={{ ...s.gateReasonTag, color: isApproval ? 'var(--warn)' : 'var(--err)' }}>
          {isApproval ? <ShieldAlert size={13} /> : <AlertTriangle size={13} />}
          {isApproval ? '高风险操作待批准' : '自动处理失败，需人工决定'}
        </span>
        <span style={s.gateTaskId}>任务 #{item.task_id}</span>
      </div>

      <div style={s.gateDesc}>{item.description || '（无描述）'}</div>

      {item.error && (
        <div style={s.gateError}><span style={{ color: 'var(--err)', fontWeight: 600 }}>错误：</span>{item.error}</div>
      )}
      {isApproval && item.risk_type && (
        <div style={s.gateError}><span style={{ color: 'var(--warn)', fontWeight: 600 }}>涉及 Agent：</span>{item.risk_type}</div>
      )}
      {item.downstream_blocked?.length > 0 && (
        <div style={s.gateDownstream}>
          连带影响下游任务：{item.downstream_blocked.map(id => `#${id}`).join('、')}
        </div>
      )}

      <div style={s.gateActionRow}>
        <select
          value={action}
          onChange={e => onChange({ ...decision, action: e.target.value })}
          style={s.select}
        >
          <option value="" disabled>请选择处理方式…</option>
          {actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>

      {action === 'edit_and_retry' && (
        <textarea
          value={decision?.patchDescription || ''}
          onChange={e => onChange({ ...decision, patchDescription: e.target.value })}
          placeholder="输入修改后的任务描述（留空则保持原描述，仅重置重试次数后重跑）"
          style={s.patchTextarea}
        />
      )}
      {(action === 'skip' || action === 'reject') && (
        <textarea
          value={decision?.patchManualResult || ''}
          onChange={e => onChange({ ...decision, patchManualResult: e.target.value })}
          placeholder="（可选）为这个任务手动提供一个替代结果，供依赖它的下游任务使用；留空则用默认占位文案"
          style={s.patchTextarea}
        />
      )}
    </div>
  )
}

// ── 任务列表行 ───────────────────────────────────────────
function TaskRow({ t }) {
  return (
    <div style={s.taskRow} className="fade-in">
      <span style={s.taskId}>#{t.task_id}</span>
      <div style={s.taskMain}>
        <div style={s.taskDesc} title={t.description}>{t.description}</div>
        <div style={s.taskMeta}>
          <span style={s.taskAgent}>{t.agent}</span>
          {t.depends_on?.length > 0 && (
            <span style={s.taskDeps}>依赖 {t.depends_on.map(d => `#${d}`).join(',')}</span>
          )}
          {t.retry_count > 0 && (
            <span style={s.taskRetry}>已重试 {t.retry_count}/{t.max_retries} 次</span>
          )}
          {t.high_risk && <span style={s.taskRisk}>高风险</span>}
        </div>
        {t.last_error && <div style={s.taskErr}>最近错误：{t.last_error}</div>}
      </div>
      <StatusBadge status={t.status} />
    </div>
  )
}

export default function TaskReviewPanel() {
  const [userId,   setUserId]   = useState('default')
  const [threadId, setThreadId] = useState('')
  const [state,    setState]    = useState(null)   // TaskPlanStateResponse
  const [decisions, setDecisions] = useState({})   // { [task_id]: { action, patchDescription, patchManualResult } }
  const [loading,  setLoading]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]    = useState('')
  const [banner,   setBanner]   = useState(null)   // { kind: 'answer'|'aborted', text }

  // 挂载时从共享存储里读取"最近一次在其他面板用过的会话"
  useEffect(() => {
    const t = getCurrentThread()
    if (t.threadId) { setUserId(t.userId); setThreadId(t.threadId) }
    
  }, [])

  // ★ 改动：新增 preserveBanner 参数（默认 false，跟原行为一致）。
  //   submitDecisions/abortAll 设置完 banner 之后紧跟着调用 refresh() 拉取最新状态，
  //   但 refresh 原来无条件 setBanner(null)——会把刚设置好的 banner（无论是流式
  //   逐字更新的，还是原来一次性的）立刻清空，用户根本看不到。
  //   这里加个开关：用户手动点"刷新"按钮时清空（走默认值），
  //   提交决策/终止计划之后的自动刷新时保留 banner。
  const refresh = useCallback(async (tid, uid, preserveBanner = false) => {
    const useTid = tid ?? threadId
    const useUid = uid ?? userId
    if (!useTid.trim()) { setError('请输入 Thread ID'); return null }
    setLoading(true); setError('')
    try {
      const res = await apiGetTaskPlanState(useTid.trim(), useUid.trim() || 'default')
      setState(res)
      setDecisions({})
      if (!preserveBanner) setBanner(null)
      return res   // 把最新状态返回给调用方（submitDecisions 需要用 plan_status 判断展示样式）
    } catch (e) {
      setError(e.message || '查询失败')
      setState(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [threadId, userId])

  const handleThreadBlur = () => {
    if (threadId.trim()) setCurrentThread({ userId: userId.trim() || 'default', threadId: threadId.trim() })
  }

  const pendingItems = state?.pending_gate_items || []
  const allDecided = pendingItems.length > 0 && pendingItems.every(it => decisions[it.task_id]?.action)

  // ★ 改动：改用流式恢复接口（/resume/stream），决策提交后如果图一路跑到
  //   final_answer_node，banner 会逐字更新，而不是等生成完毕才整段出现。
  //   多轮 HITL（提交一批又冻结、再提交下一批）体验跟 /chat/stream 完全一致。
  //   非流式的 apiResumeTaskPlan 仍然保留在 lib/client.js 里，未来要退回
  //   一次性提交的话直接换回原来那几行即可。
  const submitDecisions = async () => {
    if (!allDecided) return
    setSubmitting(true); setError('')
    try {
      const payload = pendingItems.map(it => {
        const d = decisions[it.task_id]
        let patch = null
        if (d.action === 'edit_and_retry' && d.patchDescription?.trim()) {
          patch = { description: d.patchDescription.trim() }
        } else if ((d.action === 'skip' || d.action === 'reject') && d.patchManualResult?.trim()) {
          patch = { manual_result: d.patchManualResult.trim() }
        }
        return { task_id: it.task_id, action: d.action, patch }
      })

      setBanner({ kind: 'streaming', text: '' })   // 先给个空的"生成中"占位，token 陆续填进来

      await new Promise((resolve, reject) => {
        apiResumeTaskPlanStream({
          thread_id: threadId.trim(),
          decisions: payload,
          userId: userId.trim() || 'default',
          onToken: (_, full) => setBanner({ kind: 'streaming', text: full }),
          onDone: () => {
            setBanner(prev => ({ kind: 'answer', text: (prev?.text || '').trim() || '（任务计划已完成）' }))
            resolve()
          },
          onInterrupted: (payload) => {
            const items = payload?.pending_gate_items || []
            setBanner({ kind: 'info', text: `本批决策已提交，又出现了 ${items.length} 项新的待处理事项，请继续处理。` })
            resolve()
          },
          onRejected: (payload) => {
            reject(new Error(payload?.message || '当前会话不处于等待人工处理状态'))
          },
          onError: (msg) => reject(new Error(msg)),
        })
      })

      // 无论如何都重新拉取最新的完整状态（任务列表 + 最新待办事项）
      // preserveBanner=true：不要让 refresh 把上面刚设置好的 banner 清空
      const freshState = await refresh(threadId, userId, true)
      // 流式收尾的 [DONE] 事件不带 plan_status，这里用 refresh 拿到的最新状态
      // 补一次判断：如果这批决策里包含 abort_all，最终状态会是 aborted，
      // 银幕上的图标该换成"已终止"而不是"已完成"（对应原来非流式版本的逻辑）
      // ★ 说明（非 bug，仅澄清）：当前 GateItemCard 的下拉框里没有暴露
      //   'abort_all' 这个 action（终止整个计划走的是下面独立的 abortAll()
      //   函数，调用 /abort，不经过这里），所以这个分支在现有 UI 下不会被触发。
      //   保留作为防御性兜底：万一未来给 GateItemCard 加了 abort_all 选项，
      //   或者有别的调用方直接打 /resume/stream 塞了 abort_all 决策，这里
      //   依然能正确处理。
      if (freshState?.plan_status === 'aborted') {
        setBanner(prev => ({ kind: 'aborted', text: prev?.text || '任务计划已终止。' }))
      }
    } catch (e) {
      // ★ 修复：之前这里只 setError，没有清掉上面 setBanner({kind:'streaming'}) 留下的
      //   占位——onRejected/onError 触发时会导致一个"生成中…"的转圈框永久卡在
      //   界面上，跟下面刚冒出来的错误提示同时存在、互相矛盾。这里统一把 banner
      //   清空，只保留 errorBox 一个信息源。
      setError(e.message || '提交决策失败')
      setBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  // ★ 改动：跟 submitDecisions 一样换成流式接口（/abort/stream），终止后台的
  //   final_answer_node 收尾回答会逐字更新，而不是等生成完毕才整段出现。
  //   非流式的 apiAbortTaskPlan 仍然保留在 lib/client.js 里，未来要退回
  //   一次性提交的话直接换回原来那几行即可。
  const abortAll = async () => {
    if (!window.confirm('确认要终止整个任务计划吗？未完成的任务将不再执行，此操作不可撤销。')) return
    setSubmitting(true); setError('')
    try {
      setBanner({ kind: 'streaming', text: '' })   // 先给个空的"生成中"占位，token 陆续填进来

      await new Promise((resolve, reject) => {
        apiAbortTaskPlanStream({
          thread_id: threadId.trim(),
          userId: userId.trim() || 'default',
          onToken: (_, full) => setBanner({ kind: 'streaming', text: full }),
          onDone: () => {
            setBanner(prev => ({ kind: 'aborted', text: (prev?.text || '').trim() || '任务计划已终止。' }))
            resolve()
          },
          // 理论上不会走到这里（见 apiAbortTaskPlanStream 注释），保留只是为了
          // 跟 submitDecisions 的处理方式保持一致，不遗漏任何边缘情况。
          onInterrupted: (payload) => {
            const items = payload?.pending_gate_items || []
            setBanner({ kind: 'info', text: `终止请求已提交，但又出现了 ${items.length} 项新的待处理事项，请继续处理。` })
            resolve()
          },
          onRejected: (payload) => {
            reject(new Error(payload?.message || '当前会话不处于等待人工处理状态'))
          },
          onError: (msg) => reject(new Error(msg)),
        })
      })

      // preserveBanner=true：不要让 refresh 把上面刚设置好的 banner 清空
      await refresh(threadId, userId, true)
    } catch (e) {
      // ★ 修复：同 submitDecisions，出错时把卡在"生成中"的 banner 一起清掉，
      //   避免转圈框和错误提示同时出现、互相矛盾。
      setError(e.message || '终止失败')
      setBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部：会话选择 */}
      <div style={s.topBar}>
        <span style={s.topLabel}>User ID</span>
        <input value={userId} onChange={e => setUserId(e.target.value)} onBlur={handleThreadBlur}
          placeholder="default" style={{ ...s.input, width: 110 }} />
        <span style={s.topLabel}>Thread ID</span>
        <input value={threadId} onChange={e => setThreadId(e.target.value)} onBlur={handleThreadBlur}
          placeholder="要查看的会话 ID（跟 Chat 面板里的一致）" style={{ ...s.input, flex: 1, minWidth: 160 }} />
        <button onClick={() => refresh()} disabled={loading} style={s.refreshBtn}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> 刷新
        </button>
        {state && <PlanStatusBadge status={state.plan_status} />}
      </div>

      <div style={s.body}>
        {error && <div style={s.errorBox}>{error}</div>}

        {banner && (
          <div style={{
            ...s.bannerBox,
            borderColor: banner.kind === 'aborted' ? 'var(--err)' : banner.kind === 'info' ? 'var(--warn)' : 'var(--ok)',
          }} className="fade-in">
            {banner.kind === 'aborted'   && <OctagonX size={15} color="var(--err)" style={{ flexShrink: 0 }} />}
            {banner.kind === 'answer'    && <CheckCircle2 size={15} color="var(--ok)" style={{ flexShrink: 0 }} />}
            {banner.kind === 'info'      && <AlertTriangle size={15} color="var(--warn)" style={{ flexShrink: 0 }} />}
            {/* ★ 新增：streaming——resume/stream 逐 token 生成中，用旋转图标提示还没定稿 */}
            {banner.kind === 'streaming' && <RefreshCw size={15} color="var(--ok)" style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />}
            <span style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7 }}>
              {banner.text || (banner.kind === 'streaming' ? '生成中…' : '')}
            </span>
          </div>
        )}

        {!state && !loading && !error && (
          <div style={s.empty}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🗂️</div>
            <div style={{ fontFamily: 'var(--mono)', color: 'var(--sub)', fontSize: 13 }}>
              输入 Thread ID 并点击「刷新」查看任务计划状态
            </div>
            <div style={{ marginTop: 6, color: 'var(--border2)', fontSize: 12 }}>
              在 Chat 面板发过消息后，会自动带入最近使用的会话 ID
            </div>
          </div>
        )}

        {state && pendingItems.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionTitle}>
              待处理事项（{pendingItems.length}）
              <span style={s.sectionHint}>一次性处理完这批事项后统一提交</span>
            </div>
            {pendingItems.map(item => (
              <GateItemCard
                key={item.task_id}
                item={item}
                decision={decisions[item.task_id]}
                onChange={(d) => setDecisions(prev => ({ ...prev, [item.task_id]: d }))}
              />
            ))}
            <div style={s.submitRow}>
              <button onClick={submitDecisions} disabled={!allDecided || submitting} style={s.submitBtn}>
                <Send size={14} /> {submitting ? '提交中…' : `提交全部决策（${pendingItems.length}）`}
              </button>
              <button onClick={abortAll} disabled={submitting} style={s.abortBtn}>
                <OctagonX size={14} /> 终止整个计划
              </button>
              {!allDecided && (
                <span style={s.submitHint}>还有 {pendingItems.length - Object.values(decisions).filter(d => d?.action).length} 项未选择处理方式</span>
              )}
            </div>
          </div>
        )}

        {state && (
          <div style={s.section}>
            <div style={s.sectionTitle}>任务列表（{state.task_plan?.length || 0}）</div>
            {(state.task_plan || []).map(t => <TaskRow key={t.task_id} t={t} />)}
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  topBar: {
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
  bannerBox: {
    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 9,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle: {
    fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: 'var(--text)',
    display: 'flex', alignItems: 'baseline', gap: 10,
  },
  sectionHint: { fontFamily: 'var(--sans)', fontSize: 11.5, fontWeight: 400, color: 'var(--sub)' },

  // gate item card
  gateCard: {
    display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px',
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 10,
  },
  gateCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  gateReasonTag: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 },
  gateTaskId: { fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--sub)' },
  gateDesc: { fontSize: 13, lineHeight: 1.6, color: 'var(--text)' },
  gateError: { fontSize: 12, color: 'var(--sub)', background: 'rgba(248,113,113,.06)', borderRadius: 6, padding: '6px 10px' },
  gateDownstream: { fontSize: 11.5, color: 'var(--warn)', fontFamily: 'var(--mono)' },
  gateActionRow: { display: 'flex', gap: 8, marginTop: 2 },
  select: {
    flex: 1, padding: '7px 10px', background: 'var(--s3)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none',
  },
  patchTextarea: {
    padding: '8px 10px', background: 'var(--s3)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)',
    outline: 'none', resize: 'vertical', minHeight: 54, lineHeight: 1.6,
  },
  submitRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  submitBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--accent)',
    border: 'none', borderRadius: 8, color: '#fff', fontSize: 12.5, fontWeight: 700,
    fontFamily: 'var(--sans)', cursor: 'pointer',
  },
  abortBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'rgba(248,113,113,.1)',
    border: '1px solid rgba(248,113,113,.35)', borderRadius: 8, color: 'var(--err)', fontSize: 12.5,
    fontWeight: 700, fontFamily: 'var(--sans)', cursor: 'pointer',
  },
  submitHint: { fontSize: 11.5, color: 'var(--sub)' },

  // task row
  taskRow: {
    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px',
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 9,
  },
  taskId: { fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--sub)', flexShrink: 0, paddingTop: 1 },
  taskMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  taskDesc: { fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  taskMeta: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  taskAgent: { fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--accent2)', background: 'rgba(29,233,182,.08)', borderRadius: 5, padding: '1px 6px' },
  taskDeps: { fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--sub)' },
  taskRetry: { fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--warn)' },
  taskRisk: { fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--err)', fontWeight: 700 },
  taskErr: { fontSize: 11.5, color: 'var(--err)', marginTop: 2 },
}
