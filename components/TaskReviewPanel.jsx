// components/TaskReviewPanel.jsx
//
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
//
// ★★★ Bugfix（本次改动，已对照 api.py 的 GateItemModel / HumanDecisionIn 校准）★★★
//   现象：pending_approval 类型的事项选择"批准执行"后，无论怎么提交，
//   后端都返回「需要在确认框中原样输入「确认执行-xxx-N」才能批准执行，
//   请重新提交」。
//
//   根因分两层：
//     1) UI 层面：GateItemCard 从始至终只有一个下拉框，从来没有为二次
//        确认渲染过输入框，用户根本没地方填。
//     2) 字段对齐层面（上一版还没修对）：后端 GateItemModel 把令牌放在
//        requires_confirm_phrase 字段里明确吐出来了（不需要猜/不需要从
//        error 文案里正则抠），而 HumanDecisionIn 要求确认文本必须嵌在
//        patch.confirm_text 里，跟 task_id/action 平级——上一版发成了
//        顶层字段，Pydantic 模型没有这个字段，请求体里的它会被直接丢弃，
//        后端永远收不到，所以怎么填都还是报"未确认"。
//
//   修复：
//     1) extractConfirmPhrase()：直接读 item.requires_confirm_phrase
//        （后端已修复补上这个字段）；仅在其为空时，才用正则从 error
//        文案里兜底解析，正常链路走不到这一步。
//     2) GateItemCard：reason === 'pending_approval' 且选择 approve、
//        且 requires_confirm_phrase 非空时，才展示确认框——为空代表
//        这条 approve 本来就不需要二次确认。
//     3) allDecided：把"确认文本是否匹配 requires_confirm_phrase"也
//        纳入"是否已决策完成"的判断，没填对之前提交按钮保持禁用。
//     4) submitDecisions：把 confirm_text 正确嵌进 patch 对象里
//        （patch.confirm_text），而不是发成顶层字段。
//
//   另外：input_guardrail（规划前的语义复核，比如截图第一轮"输入内容
//   触发安全策略"）跟 pending_approval（规划后具体任务的高风险批准）
//   原本是后端图里两个独立的 interrupt() 断点——后者对应的任务要等前者
//   被批准、planner_node 真正规划出任务之后才会存在，前端在第一关
//   拿不到还没生成的东西，所以两关必然分两轮出现，这不是前端能合并的，
//   需要改后端图结构（提前规划/预校验）才能把两关合成一次展示。
//   ★ 20260828 更新：planner_node 里输入侧命中风险已经改成只记审计日志、
//   不再 return waiting_human 早退（见 langgraph_parallel_agent.py），
//   所以 input_guardrail 这个 reason 目前不会再出现——下面 input_guardrail
//   相关的分支（STAGE_HINT.input / ACTIONS_BY_REASON.input_guardrail /
//   scopeLabel/descLabel 里的 input_guardrail 判断）先保留成死代码，不删，
//   等后端哪天恢复输入侧阻断时前端不用跟着重写；真恢复之前它们不会被触发。

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, AlertTriangle, ShieldAlert, CheckCircle2, XCircle,
  Clock, Ban, PlayCircle, SkipForward, Edit3, Send, OctagonX, ShieldQuestion,
  ShieldCheck,
} from 'lucide-react'
import { apiGetTaskPlanState, apiResumeTaskPlan, apiResumeTaskPlanStream, apiAbortTaskPlanStream } from '../lib/client.js'
import { getCurrentThread, setCurrentThread, onCurrentThreadChange } from '../lib/shared.js'
import { reasonMeta, riskTypeLabel, isGuardrailItem, reasonStage, stageMeta, TONE_COLOR } from '../lib/guardrail.js'

// ★ 新增：每种 stage 对应的"这一关审的是什么、什么时候出现"一句话说明。
//   跟 GateItemCard 里的常驻角标配套用。
//   ★ 20260828 更新：exec 原文写的是"只有输入侧这一关通过才会出现"，暗示
//   还有一道会拦人的输入侧审批——但输入侧现在只记审计日志、不再中断（见
//   上面的更新说明），这句话会误导用户以为自己刚过了一关审批。改成不
//   预设"审批关卡"的中性说法；input 这条目前不会被渲染（reasonStage()
//   永远不会再对 input_guardrail 返回 'input'，因为这个 reason 不会再
//   出现），保留是为了配合上面同一理由保留的死代码分支。
const STAGE_HINT = {
  input:  '规划任务之前 · 审的是你这句话本身，还没有具体任务',
  exec:   '规划任务之后 · 审的是某个具体任务在真正执行前的风险',
  output: '任务执行完之后 · 审的是最终要展示给你的回答内容',
}

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
  // ★ Guardrail 改动：input_review_gate_node 批准后会短暂把 plan_status
  //   设成 replanning，再路由回 planner_node 重新规划——这是个转瞬即逝的
  //   中间态，正常情况下 GET /state 很难刚好撞见，但理论上有极小概率窗口
  //   （planner_node 那次真实 LLM 调用比较慢时）。加这一条只是防御性兜底，
  //   避免真撞见时显示成"未知状态"。
  replanning:     { label: '重新规划中',   color: 'var(--accent)' },
}

// 不同 reason 下，用户可以选择的动作。
// ★ Guardrail 改动：新增 input_guardrail / output_guardrail 两种 reason，
//   跟后端 input_review_gate_node / output_review_gate_node 的处理能力一一
//   对应——这两个节点目前只认 approve / reject（未知 action 一律保守按
//   reject 处理，见后端注释），不支持 retry/edit_and_retry/skip 那一套，
//   所以这里的下拉选项也只给 approve/reject，不能选出后端不认的动作。
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
  input_guardrail: [
    { value: 'approve', label: '批准继续（放行这条消息，重新为其规划任务）' },
    { value: 'reject',  label: '拒绝（终止本次请求，向用户返回委婉说明）' },
  ],
  output_guardrail: [
    { value: 'approve', label: '批准发出（原样展示这条候选回答）' },
    { value: 'reject',  label: '拒绝（改用委婉说明替代，不展示原始内容）' },
  ],
}

// ★ 修复：对照后端 api.py 的 GateItemModel，令牌就是 requires_confirm_phrase
//   字段，后端已经原样吐出来了，不需要靠猜字段名或者正则抠 error 文案。
//   非空时表示"这条 approve 需要二次确认"，为空/undefined 时表示这条
//   pending_approval 不需要二次确认（approve 可以直接提交）。
//   下面的 error 正则解析只保留作极端兜底（比如后端某个更老的分支还没
//   补上这个字段），正常链路走到不会用到。
function extractConfirmPhrase(item) {
  if (item.requires_confirm_phrase) return item.requires_confirm_phrase

  const m = /「([^」]+)」/.exec(item.error || '')
  if (m) return m[1]

  return null
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
// ★ Guardrail 改动：原来只区分 pending_approval / needs_human 两种展示
//   （isApproval 布尔值），现在改用 reasonMeta() 统一驱动 4 种 reason 的
//   header 文案/配色，新增的两种 guardrail reason（input/output）不再
//   套用"任务 #{task_id}"这个措辞——它们的 task_id 是 -1/-2 这种不对应
//   任何真实任务的哨兵值，写"任务 #-1"只会让人困惑，改成更准确的
//   "本轮用户消息" / "本轮生成回答"。
function GateItemCard({ item, decision, onChange }) {
  const meta = reasonMeta(item.reason)
  const isGuardrail = isGuardrailItem(item)
  // ★ 新增：阶段角标——input_guardrail/pending_approval/output_guardrail
  //   分别对应输入侧/执行侧/输出侧，跟审计日志页用同一套 stageMeta，
  //   让用户在卡片上就能常驻看到"这是第几关"，不用去猜。
  const stage = reasonStage(item.reason)
  const stageInfo = stage ? stageMeta(stage) : null
  const actions = ACTIONS_BY_REASON[item.reason] || ACTIONS_BY_REASON.needs_human
  const action = decision?.action || ''
  const tagColor = meta.tone === 'err' ? 'var(--err)' : 'var(--warn)'

  const HeaderIcon =
    item.reason === 'input_guardrail' || item.reason === 'output_guardrail' ? ShieldQuestion
    : item.reason === 'pending_approval' ? ShieldAlert
    : AlertTriangle

  const scopeLabel = 
    item.reason === 'input_guardrail'  ? '本轮用户消息'
    : item.reason === 'output_guardrail' ? '本轮生成回答'
    : `任务 #${item.task_id}`

  const descLabel = 
    item.reason === 'input_guardrail'  ? '触发规则的用户消息：'
    : item.reason === 'output_guardrail' ? '触发规则的候选回答（其中 PII 已自动脱敏）：'
    : ''

  // ★ 修复：是否需要展示"高风险操作二次确认"输入框——只有 pending_approval
  //   且选了 approve，并且后端明确给了 requires_confirm_phrase（非空）才需要。
  //   不再对所有 pending_approval+approve 都强制要求确认——按后端语义，
  //   这个字段为空就代表这条 approve 本来就不需要二次确认。
  const expectedPhrase = item.reason === 'pending_approval' && action === 'approve'
    ? extractConfirmPhrase(item)
    : null
  const needsConfirm = !!expectedPhrase
  const confirmMatched = needsConfirm && (decision?.confirmText || '').trim() === expectedPhrase

  return (
    <div style={{
      ...s.gateCard,
      borderColor: isGuardrail ? 'rgba(248,113,113,.35)' : 'var(--border)',
      background:  isGuardrail ? 'rgba(248,113,113,.05)' : 'var(--s2)',
    }} className="fade-up">
      <div style={s.gateCardHeader}>
        <span style={{ ...s.gateReasonTag, color: tagColor }}>
          <HeaderIcon size={13} />
          {meta.label}
        </span>
        {/* ★ 新增：常驻阶段角标，跟审计日志页同色系，输入侧/执行侧/输出侧一眼区分 */}
        {stageInfo && (
          <span style={{
            ...s.stageBadge,
            color: TONE_COLOR[stageInfo.tone],
            borderColor: `${TONE_COLOR[stageInfo.tone]}40`,
            background: `${TONE_COLOR[stageInfo.tone]}1a`,
          }}>
            {stageInfo.label}
          </span>
        )}
        <span style={s.gateTaskId}>{scopeLabel}</span>
      </div>

      {/* ★ 新增：这一关审的是什么、跟其他关卡的先后关系 */}
      {stage && <div style={s.gateStageHint}>{STAGE_HINT[stage]}</div>}

      {descLabel && <div style={s.gateDescLabel}>{descLabel}</div>}
      <div style={s.gateDesc}>{item.description || '（无描述）'}</div>

      {item.error && (
        <div style={s.gateError}><span style={{ color: 'var(--err)', fontWeight: 600 }}>错误：</span>{item.error}</div>
      )}
      {item.risk_type && (
        <div style={{ ...s.gateError, background: isGuardrail ? 'rgba(248,113,113,.08)' : s.gateError.background }}>
          <span style={{ color: tagColor, fontWeight: 600 }}>风险类型：</span>{riskTypeLabel(item.risk_type)}
        </div>
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

      {/* ★ 新增：高风险操作二次确认——批准前必须原样输入指定令牌 */}
      {needsConfirm && (
        <div style={s.confirmBox}>
          <div style={s.confirmHint}>
            <ShieldCheck size={13} style={{ flexShrink: 0 }} />
            二次确认：请在下方原样输入以下令牌后才能提交这条批准
          </div>
          <div style={s.confirmToken} onClick={e => {
            // 方便用户直接选中复制，减少手动敲错的概率
            const range = document.createRange()
            range.selectNodeContents(e.currentTarget)
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
          }}>
            {expectedPhrase}
          </div>
          <input
            type="text"
            value={decision?.confirmText || ''}
            onChange={e => onChange({ ...decision, confirmText: e.target.value })}
            placeholder="在此原样输入上方令牌…"
            style={{
              ...s.confirmInput,
              borderColor: !decision?.confirmText ? 'var(--border)'
                : confirmMatched ? 'var(--ok)' : 'var(--err)',
            }}
          />
          {decision?.confirmText && !confirmMatched && (
            <div style={s.confirmMismatch}>输入内容与令牌不一致，请核对后重新输入</div>
          )}
        </div>
      )}

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
  // ★ Bugfix (react-hooks/set-state-in-effect)：原来用一个挂载时的 useEffect
  //   从共享存储读取"最近一次在其他面板用过的会话"，再同步 setState，会触发
  //   一次多余的级联渲染。这里改成 useState 的惰性初始化函数：只在首次渲染
  //   时执行一次，直接得到正确的初始值，完全不需要 effect。
  const [userId,   setUserId]   = useState(() => {
    const t = getCurrentThread()
    return t.threadId ? t.userId : 'default'
  })
  const [threadId, setThreadId] = useState(() => getCurrentThread().threadId || '')
  const [state,    setState]    = useState(null)   // TaskPlanStateResponse
  const [decisions, setDecisions] = useState({})   // { [task_id]: { action, patchDescription, patchManualResult, confirmText } }
  const [loading,  setLoading]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,    setError]    = useState('')
  const [banner,   setBanner]   = useState(null)   // { kind: 'answer'|'aborted', text }

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

  // ★ Bugfix：AppShell 现在把访问过的面板保持挂载（切走只隐藏，不卸载，
  //   见 AppShell.jsx 的改动），本面板不再是每次切进来都重新 mount 一遍
  //   ——上面那个只在"挂载时"读一次 getCurrentThread() 的 effect 因此只会
  //   在用户第一次点进「人工审核」时生效一次。如果用户是从 Batch Test /
  //   Chat 的「前往人工审核」按钮跳转过来（针对某一条具体用例设置了新的
  //   thread_id），且本面板之前已经被访问过、还挂载在后台，就不会再收到
  //   这个新的 thread_id，导致停留在上一次查看的会话上，审核了错误/过期
  //   的那一条。这里改成订阅 lib/shared.js 的跨面板变更事件：只要别的面板
  //   调用 setCurrentThread（不管本面板当前是显示还是隐藏），都同步更新
  //   thread_id/user_id，并直接拉一次最新状态，省得用户还要手动点刷新。
  useEffect(() => {
    return onCurrentThreadChange(({ userId: uid, threadId: tid }) => {
      if (!tid) return
      const nextUid = uid || 'default'
      setUserId(nextUid)
      setThreadId(tid)
      refresh(tid, nextUid)
    })
  }, [refresh])

  const handleThreadBlur = () => {
    if (threadId.trim()) setCurrentThread({ userId: userId.trim() || 'default', threadId: threadId.trim() })
  }

  const pendingItems = state?.pending_gate_items || []

  // ★ 修复：原来 allDecided 只判断"是否选了 action"，现在对于
  //   pending_approval + approve 且后端给了 requires_confirm_phrase 的情况，
  //   还要求用户输入的 confirmText 跟该短语完全一致，否则不算"已决策"，
  //   提交按钮保持禁用——避免再次被后端以"未确认"为由拒绝。
  //   requires_confirm_phrase 为空（后端认为这条不需要二次确认）时，
  //   跟其他 action 一样只要选了就算完成。
  const isItemDecided = (it) => {
    const d = decisions[it.task_id]
    if (!d?.action) return false
    if (it.reason === 'pending_approval' && d.action === 'approve') {
      const phrase = extractConfirmPhrase(it)
      if (phrase) return (d.confirmText || '').trim() === phrase
    }
    return true
  }
  const allDecided = pendingItems.length > 0 && pendingItems.every(isItemDecided)

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

        // ★ 修复：对照 api.py 的 HumanDecisionIn，confirm_text 必须嵌在
        //   patch 对象里（patch.confirm_text），不是跟 task_id/action 平级
        //   的顶层字段——上一版发成顶层字段，Pydantic 模型里没有这个字段，
        //   服务端会直接忽略，导致后端一直认为"未确认"。
        if (it.reason === 'pending_approval' && d.action === 'approve' && extractConfirmPhrase(it)) {
          patch = { ...(patch || {}), confirm_text: (d.confirmText || '').trim() }
        }

        return { task_id: it.task_id, action: d.action, patch }
      })

      // ★ 调试用：提交前打一下完整 payload，方便跟后端日志对比字段是否对齐
      console.debug('[TaskReviewPanel] submit payload:', JSON.stringify(payload, null, 2))

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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
        {/* <div style={s.errorBox}>{JSON.stringify(state, null, 2)}</div> */}

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
              {/* ★ Guardrail 改动：这批事项里只要有安全策略触发的，就在标题上
                  加一个醒目的红色提示，让用户一眼看出"这不只是普通执行失败"。 */}
              {pendingItems.some(isGuardrailItem) && (
                <span style={s.guardrailHint}>
                  <ShieldQuestion size={12} />
                  含 {pendingItems.filter(isGuardrailItem).length} 项安全策略拦截
                </span>
              )}
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
                <span style={s.submitHint}>
                  还有 {pendingItems.length - pendingItems.filter(isItemDecided).length} 项未完成（未选择处理方式，或高风险批准尚未通过二次确认）
                </span>
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
  // ★ Guardrail 改动：待处理事项标题里的"含 N 项安全策略拦截"红色小标签
  guardrailHint: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--mono)',
    fontSize: 11, fontWeight: 700, color: 'var(--err)', background: 'rgba(248,113,113,.1)',
    border: '1px solid rgba(248,113,113,.3)', borderRadius: 99, padding: '2px 9px',
  },

  // gate item card
  gateCard: {
    display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px',
    background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 10,
  },
  gateCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  gateReasonTag: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 },
  // ★ 新增：常驻阶段角标（输入侧/执行侧/输出侧）
  stageBadge: {
    fontFamily: 'var(--mono)', fontSize: 10.5, fontWeight: 700,
    border: '1px solid', borderRadius: 99, padding: '1px 8px', whiteSpace: 'nowrap',
  },
  gateTaskId: { fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--sub)' },
  gateDesc: { fontSize: 13, lineHeight: 1.6, color: 'var(--text)' },
  // ★ 新增：阶段说明一句话（"规划之前/规划之后/执行完之后"）
  gateStageHint: {
    fontSize: 11, fontFamily: 'var(--sans)', color: 'var(--sub)',
    marginTop: -2, marginBottom: 2,
  },
  // ★ Guardrail 改动：input_guardrail/output_guardrail 卡片里，描述文字前面
  //   加一行小标签（"触发规则的用户消息："等），跟普通任务描述区分开
  gateDescLabel: { fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--sub)', marginTop: -2 },
  gateError: { fontSize: 12, color: 'var(--sub)', background: 'rgba(248,113,113,.06)', borderRadius: 6, padding: '6px 10px' },
  gateDownstream: { fontSize: 11.5, color: 'var(--warn)', fontFamily: 'var(--mono)' },
  gateActionRow: { display: 'flex', gap: 8, marginTop: 2 },
  select: {
    flex: 1, padding: '7px 10px', background: 'var(--s3)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)', outline: 'none',
  },

  // ★ 新增：高风险操作二次确认区域样式
  confirmBox: {
    display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2,
    padding: '10px 12px', background: 'rgba(248,113,113,.06)',
    border: '1px solid rgba(248,113,113,.3)', borderRadius: 8,
  },
  confirmHint: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
    color: 'var(--warn)', fontWeight: 600, fontFamily: 'var(--sans)',
  },
  confirmToken: {
    fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--err)',
    background: 'var(--s3)', border: '1px dashed rgba(248,113,113,.4)',
    borderRadius: 6, padding: '6px 10px', cursor: 'text', userSelect: 'all',
    width: 'fit-content',
  },
  confirmInput: {
    padding: '7px 10px', background: 'var(--s3)', border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12.5,
    outline: 'none',
  },
  confirmMismatch: { fontSize: 11, color: 'var(--err)' },

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