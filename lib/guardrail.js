// lib/guardrail.js
// ────────────────────────────────────────────────────────
// ★ Guardrail 改动：前端对后端 Guardrail（安全防护）能力的统一识别 +
//   展示映射。ChatPanel / BatchPanel / MultiTurnPanel / TaskReviewPanel
//   四个面板都要区分"这次中断是不是 Guardrail 触发的"，抽成一个共享模块，
//   避免同一套判断逻辑在 4 个组件里各写一遍、互相走样（这是最容易埋 bug
//   的地方——4 份手抄逻辑迟早会有一份漏改）。
//
// 后端背景（对应 src/guardrail.py + src/langgraph_parallel_agent.py）：
//   pending_gate_items 里的每一项现在有 4 种 reason：
//     needs_human       — 原有：工具调用失败，自动重试耗尽，纯粹是"执行失败"，
//                          跟安全策略无关。
//     pending_approval  — 执行侧 Guardrail：db_agent/file_agent/http_agent
//                          即将执行的操作命中了规则引擎（危险SQL/路径穿越/
//                          SSRF）或 LLM 语义复核，被拦下来等审批。★ 这个
//                          reason 现在 100% 来自 guardrail 判定（不再是单纯
//                          "高风险 agent" 的粗糙启发式），整体归为 guardrail。
//     input_guardrail   — 输入侧 Guardrail：用户消息命中 prompt_injection /
//                          sensitive_content 规则，规划前就被拦下，
//                          task_id 固定为 -1（不对应任何真实任务）。
//     output_guardrail  — 输出侧 Guardrail：AI 生成的回答（仅非流式路径）
//                          命中 sensitive_content 规则，发出前被拦下，
//                          task_id 固定为 -2。
//   risk_type 字段的取值也从"就是个 agent 名字"变成了具体的规则类别：
//     dangerous_sql / path_traversal / ssrf / prompt_injection /
//     sensitive_content / pii_leak(:phone|:id_card|:email)，
//     或 llm:<分类>（LLM 语义复核命中）、heuristic:<agent>（规则引擎
//     兜底的旧启发式命中，没有更具体的规则分类时的兜底标签）。
// ────────────────────────────────────────────────────────

export const GUARDRAIL_REASONS = new Set(['pending_approval', 'input_guardrail', 'output_guardrail'])

/** 单个 gate item 是不是 Guardrail 触发的（而不是普通的"执行失败需要人工重试"）。*/
export function isGuardrailItem(item) {
  return GUARDRAIL_REASONS.has(item?.reason)
}

/**
 * 对一批 pending_gate_items 做整体分类，用于气泡/卡片该用"安全审核"的红色调
 * 还是"执行失败"的琥珀色调。
 *
 * 只要这一批里有任何一项是 guardrail 触发的，整体就按"安全审核"展示——
 * 安全相关的事情优先级更高，不应该被"还有几个普通失败任务"这种更常见的
 * 情况淹没掉、误导用户以为只是普通报错。
 */
export function classifyGateItems(items = []) {
  const guardrailItems = items.filter(isGuardrailItem)
  const plainItems = items.filter(it => !isGuardrailItem(it))

  
  return {
    total: items.length,
    guardrailCount: guardrailItems.length,
    plainCount: plainItems.length,
    hasGuardrail: guardrailItems.length > 0,
    hasPlain: plainItems.length > 0,
    dominant: guardrailItems.length > 0 ? 'guardrail' : 'plain',
  }
}

const REASON_META = {
  needs_human:      { label: '自动处理失败，需人工决定', shortLabel: '执行失败',   tone: 'warn' },
  pending_approval: { label: '高风险操作待批准',         shortLabel: '高风险操作', tone: 'err'  },
  input_guardrail:  { label: '输入内容触发安全策略',      shortLabel: '输入审核',   tone: 'err'  },
  output_guardrail: { label: '生成内容触发安全策略',      shortLabel: '输出审核',   tone: 'err'  },
}

/** reason → { label, shortLabel, tone }，tone 是 'err'（红，guardrail 相关）或 'warn'（琥珀，普通失败）。*/
export function reasonMeta(reason) {
  return REASON_META[reason] || { label: reason || '待处理', shortLabel: '待处理', tone: 'warn' }
}

// ★ 新增：reason → stage 的映射。TaskReviewPanel 里 input_guardrail（规划前，
//   审用户消息本身）和 pending_approval（规划后，审具体任务）是后端图里两个
//   独立的 interrupt() 断点，容易被误认成"同一种审核出现了两次"。这里复用
//   审计日志页（GuardrailAdminPanel）已经在用的 STAGE_META（输入侧/执行侧/
//   输出侧），让审核卡片也能挂上同一套"阶段"角标，两处页面文案/配色保持
//   一致，不用重新发明一套。needs_human 不属于任何 guardrail 阶段，不映射。
const REASON_STAGE = {
  input_guardrail:  'input',
  pending_approval: 'exec',
  output_guardrail: 'output',
}

/** reason → stage 原始值（'input'|'exec'|'output'），非 guardrail 的 reason 返回 null。
 *  跟 stageMeta() 配合，用于在待审核卡片上标出"输入侧/执行侧/输出侧"角标。*/
export function reasonStage(reason) {
  return REASON_STAGE[reason] || null
}

// risk_type → 人类可读标签，覆盖 guardrail.py 的 RULE_CATEGORIES 全部取值，
// 以及 llm: / heuristic: / pii_leak: 三种前缀。
const RISK_TYPE_LABELS = {
  dangerous_sql:     '危险 SQL（无条件更新/删除、DROP 等）',
  path_traversal:    '路径穿越 / 越权文件访问',
  ssrf:              'SSRF（内网地址 / 云元数据端点）',
  prompt_injection:  '提示词注入',
  sensitive_content: '违禁 / 敏感内容',
  pii_leak:          'PII 泄露特征',
}

/** risk_type 原始值（如 "dangerous_sql"、"llm:疑似批量导出"）→ 展示用中文标签。*/
export function riskTypeLabel(riskType) {
  if (!riskType) return ''
  if (RISK_TYPE_LABELS[riskType]) return RISK_TYPE_LABELS[riskType]
  if (riskType.startsWith('pii_leak:')) return `PII 泄露 · ${riskType.slice(9) || '未知字段'}`
  if (riskType.startsWith('llm:'))      return `AI 语义复核：${riskType.slice(4) || '疑似风险'}`
  if (riskType.startsWith('heuristic:')) return `规则兜底命中（agent: ${riskType.slice(10) || '未知'}）`
  // 兜底：未知/旧数据取值，原样展示，不让用户看到空白
  return riskType
}

/**
 * 给一批 gateItems 生成一句适合在 Chat / Batch / MultiTurn 里展示的摘要文案。
 * 纯 guardrail 且能判断出是输入侧还是输出侧时，给出更具体的措辞；
 * 混合或无法细分时退回通用文案；完全没有 guardrail 项时保持原有措辞
 * （跟改造前的文案一致，不影响老用户的既有认知）。
 */
export function summarizeGateItems(items = []) {
  const { guardrailCount, plainCount, hasGuardrail, total } = classifyGateItems(items)

  if (hasGuardrail && plainCount === 0) {
    const onlyInput  = items.length > 0 && items.every(it => it.reason === 'input_guardrail')
    const onlyOutput = items.length > 0 && items.every(it => it.reason === 'output_guardrail')
    if (onlyInput)  return '你发送的这条消息触发了安全策略，已提交人工审核后才能继续。'
    if (onlyOutput) return 'AI 生成的回答涉及敏感内容，已提交人工审核后才能展示给你。'
    return `本次请求中有 ${guardrailCount} 项操作触发了安全策略，需要人工审核后才能继续。`
  }
  if (hasGuardrail && plainCount > 0) {
    return `本次请求中有 ${guardrailCount} 项触发安全策略、${plainCount} 项执行失败，均需人工处理后才能继续。`
  }
  return `本次请求中有 ${total} 个任务需要人工确认后才能继续（自动重试已耗尽，或涉及高风险操作）。`
}

// ────────────────────────────────────────────────────────
// ★ Guardrail 改动（审计/规则管理页面）：guardrail_events 表里 stage / action
//   两个字段的展示映射，对应 src/guardrail.py 里 _log_event() 的调用方式：
//     stage:  input（用户消息进 planner 前）/ exec（工具调用前）/
//             output（返回用户前）/ decision（人工审批结果）
//     action: gated（判定风险，等待人工审批）/ passed（判定无风险，放行）/
//             masked（PII 自动脱敏）/ logged_only（仅记录，不阻断——目前
//             只有输入侧检测这一处还是这个值，见 guardrail.py evaluate_input()
//             的注释）/ approved（人工批准）/ rejected（人工拒绝）
// ────────────────────────────────────────────────────────

const STAGE_META = {
  input:    { label: '输入侧',   tone: 'accent' },
  exec:     { label: '执行侧',   tone: 'warn'   },
  output:   { label: '输出侧',   tone: 'accent2' },
  decision: { label: '人工决策', tone: 'ok'     },
}

/** stage 原始值 → { label, tone }。tone 是给页面挑颜色变量用的语义标签。*/
export function stageMeta(stage) {
  return STAGE_META[stage] || { label: stage || '未知', tone: 'sub' }
}

const ACTION_META = {
  gated:       { label: '已拦截·等待审批', tone: 'err'  },
  passed:      { label: '放行',           tone: 'ok'   },
  masked:      { label: '已自动脱敏',      tone: 'warn' },
  logged_only: { label: '仅记录',         tone: 'sub'  },
  approved:    { label: '人工已批准',      tone: 'ok'   },
  rejected:    { label: '人工已拒绝',      tone: 'err'  },
}

/** action 原始值 → { label, tone }。*/
export function actionMeta(action) {
  return ACTION_META[action] || { label: action || '未知', tone: 'sub' }
}

// tone → 实际 CSS 变量名，页面里统一从这里取色，不要在组件里手写 var(--xxx)
export const TONE_COLOR = {
  err: 'var(--err)', warn: 'var(--warn)', ok: 'var(--ok)',
  accent: 'var(--accent)', accent2: 'var(--accent2)', sub: 'var(--sub)',
}