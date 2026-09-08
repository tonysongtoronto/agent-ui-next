'use client'
// components/MultiTurnPanel.jsx — Next.js 版本
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'
//
// 【暂停 / 恢复】
// - apiChatStream() 返回一个 AbortController，所以暂停是"真暂停"：
//   点击暂停会立刻 abort 当前正在流式输出的这一轮请求。
// - client.js 里 abort 触发的是 AbortError，会被 catch 吞掉，
//   既不会调用 onDone 也不会调用 onError —— 所以 run() 循环里
//   await 的 Promise 永远不会被 resolve。为了不卡死循环，
//   requestPause() 会在 abort 之后手动 resolve 这个 pending promise。
// - 被打断的这一轮（用户消息 + AI 占位气泡）会从 timeline 里撤回，
//   记录下"下次该从第几轮开始"（resumeIndexRef）。
// - 之前已经跑完的轮次（timeline + threadId）完全不动。
// - 点"继续"时用 run(true)：不清空 timeline / threadId，
//   从 resumeIndexRef 记录的位置重新完整地跑这一轮。
//
// ★ HITL 改动（对齐 BatchPanel / ChatPanel）：
// - 多轮共用同一个 thread_id。某一轮命中 human_review_gate 的
//   interrupt() 时，必须 resolve Promise，否则整条多轮队列永久卡死。
// - 把该轮 AI 占位气泡换成「等待人工审核」卡片，提供：
//     · 前往人工审核（setCurrentThread + navigateTo('review')）
//     · 刷新状态（apiGetTaskPlanState，与 Batch 同一套接口）
// - 命中中断后停止后续轮次；用户在 Review 处理完回来刷新后，
//   若已不再 waiting_human，则把该轮标为完成并允许从下一轮继续。
// - 同步 setCurrentThread，让侧边栏「人工审核」红点与 Review 面板
//   能自动带上当前会话。
import { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import { Plus, Play, Pause, RotateCcw, Trash2, ClipboardCheck, RefreshCw, ShieldQuestion } from 'lucide-react'
import { apiChatStream, apiGetTaskPlanState } from '../lib/client.js'
import { setCurrentThread, navigateTo } from '../lib/shared.js'
import { classifyGateItems, summarizeGateItems } from '../lib/guardrail.js'

const EXAMPLE_TURNS = [
  '我叫 Leo，34 岁，住在上海，是一名独立游戏开发者，专注做手机端解谜游戏。',
  '我目前在开发一款叫《迷雾塔》的游戏，计划 8 月上线，现在卡在关卡编辑器的撤销/重做功能上。',
  '我每天早上 6 点起床跑步，跑完会喝一杯黑咖啡，不加糖不加奶。我不吃猪肉，宗教原因。',
  '帮我写一篇 300 字左右的游戏行业分析文章，主题是"独立游戏在移动端的生存困境"。',
  '对了，我有一个搭档叫 Zoe，她负责美术，我们认识 7 年了，她之前在腾讯工作过。',
  '用 Python 写一个函数，实现栈结构的撤销/重做功能，要求支持最多 50 步历史记录。',
  '我的游戏叫什么名字？计划什么时候上线？目前卡在哪里？',
  '更新一下，《迷雾塔》上线时间推迟了，改成 10 月发布。',
  '帮我用中文写一段话，安慰一个因为项目延期而焦虑的朋友。',
  '我的游戏现在定的上线时间是几月？最早说的是几月？',
  '我每天几点起床？早上喝什么？我不吃什么，原因是什么？',
  'Zoe 是谁？我们认识多久了？她之前在哪里工作？',
  '综合你知道的所有信息，判断一下：我现在压力大吗？给出理由，再写一段 60 字以内的个人简介。',
]

function TimelineStep({ type, label, content, ms, isStreaming, gateCount, gateKind, checking, recheckNote, onGoReview, onRecheck }) {
  const isInterrupted = type === 'interrupted'
  const isGuardrail = isInterrupted && gateKind === 'guardrail'
  const dotStyle = {
    user: { bg:'#1a2d50', border:'#2a3a60', color:'#93c5fd', label:'U' },
    ai:   { bg:'#111827', border:'#1e2d4a', color:'var(--accent2)', label:'AI' },
    err:  { bg:'#2d1515', border:'#5a2020', color:'var(--err)', label:'!' },
    interrupted: isGuardrail
      ? { bg:'#2d1515', border:'#5a2020', color:'var(--err)', label:'!' }
      : { bg:'#3a2d10', border:'#6a5220', color:'var(--warn)', label:'!' },
  }[type] || { bg:'var(--s2)', border:'var(--border)', color:'var(--sub)', label:'?' }

  return (
    <div className="slide-in" style={{ display:'flex', gap:14 }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
        <div style={{
          width:28, height:28, borderRadius:7, display:'flex', alignItems:'center',
          justifyContent:'center', fontSize:11, fontWeight:700,
          background:dotStyle.bg, border:`1px solid ${dotStyle.border}`, color:dotStyle.color,
          fontFamily:'var(--mono)',
        }}>{isGuardrail ? <ShieldQuestion size={14} /> : dotStyle.label}</div>
        <div style={{ flex:1, width:1, background:'var(--border)', marginTop:1 }} />
      </div>

      <div style={{ flex:1, paddingBottom:16, minWidth:0 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--sub)',
          marginBottom:6, textTransform:'uppercase', letterSpacing:'.06em' }}>
          {label} 
          {ms != null && <span style={{ marginLeft:8, color:'var(--border2)' }}>{ms}ms</span>}
        </div>

        {isInterrupted ? (
          <div style={{
            background: isGuardrail ? 'rgba(248,113,113,.08)' : 'rgba(251,191,36,.08)',
            border: `1px solid ${isGuardrail ? 'rgba(248,113,113,.35)' : 'rgba(251,191,36,.35)'}`,
            borderRadius:9, padding:'12px 14px', fontSize:13.5, lineHeight:1.75,
            color:'var(--text)', display:'flex', flexDirection:'column', gap:10,
          }}>
            {isGuardrail && (
              <span style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'var(--err)',
                textTransform:'uppercase', letterSpacing:'.04em' }}>安全策略拦截</span>
            )}
            <span style={{ whiteSpace:'pre-wrap' }}>{content}</span>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <button onClick={onGoReview} style={isGuardrail ? { ...styles.reviewBtn, background:'var(--err)', color:'#1a0a0a' } : styles.reviewBtn}>
                <ClipboardCheck size={13}/> 前往人工审核（{gateCount ?? 0} 项）
              </button>
              <button
                onClick={onRecheck}
                disabled={checking}
                style={{
                  ...styles.recheckBtn,
                  opacity: checking ? .65 : 1,
                  cursor: checking ? 'default' : 'pointer',
                }}
              >
                <RefreshCw size={13} style={{ animation: checking ? 'spin .6s linear infinite' : 'none' }}/>
                {checking ? '正在检查…' : '刷新状态'}
              </button>
              {recheckNote && (
                <span style={{
                  fontSize:11, fontFamily:'var(--mono)',
                  color: recheckNote.kind === 'error' ? 'var(--err)' : 'var(--sub)',
                }}>
                  {recheckNote.kind === 'error' ? '✗ ' : '✓ '}{recheckNote.text}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            background: type==='user' ? '#172040' : type==='err' ? '#2d1515' : 'var(--s2)',
            border:`1px solid ${type==='user' ? '#2a3a60' : type==='err' ? '#5a2020' : 'var(--border)'}`,
            borderRadius:9, padding:'10px 14px', fontSize:13.5, lineHeight:1.75,
            color: type==='user' ? '#bfdbfe' : type==='err' ? 'var(--err)' : 'var(--text)',
            wordBreak:'break-word', overflowWrap:'break-word',
          }}>
            {type === 'user'
              ? <span style={{ whiteSpace:'pre-wrap' }}>{content}</span>
              : <div className="md-body" dangerouslySetInnerHTML={{ __html: marked.parse(content||'') }} />
            }
            {isStreaming && (
              <span style={{ fontFamily:'var(--mono)', color:'var(--sub)', fontSize:12,
                animation:'blink 1s step-end infinite', marginLeft:2 }}>▋</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function MultiTurnPanel() {
  const [turns,    setTurns]    = useState(EXAMPLE_TURNS)
  const [timeline, setTimeline] = useState([])
  const [threadId, setThreadId] = useState(null)
  const [running,  setRunning]  = useState(false)
  const [paused,   setPaused]   = useState(false)
  const [awaitingHuman, setAwaitingHuman] = useState(false)
  // ★ Guardrail 改动：单独记一下"当前卡住的这一轮是不是 guardrail 触发的"，
  //   只用于顶部提示条的文案/配色，不参与任何流程控制判断（awaitingHuman
  //   这个布尔值本身的语义和所有既有判断逻辑完全不变，降低改动风险）。
  const [awaitingHumanKind, setAwaitingHumanKind] = useState('plain')
  const [delay,    setDelay]    = useState(0)

  const bottomRef   = useRef(null)
  const timelineRef = useRef([])

  const pauseRequestedRef  = useRef(false)
  const resumeIndexRef     = useRef(0)
  const threadRef          = useRef(null)
  const activeControllerRef = useRef(null)
  const pendingResolveRef   = useRef(null)
  const interruptedThisTurnRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [timeline])

  const updateTimeline = (updater) => {
    setTimeline(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      timelineRef.current = next
      return next
    })
  }

  const addTurn     = () => setTurns(t => [...t, ''])
  const delTurn     = (i) => setTurns(t => t.filter((_,j)=>j!==i))
  const setTurn     = (i, v) => setTurns(t => t.map((x,j)=>j===i?v:x))
  const loadExample = () => setTurns(EXAMPLE_TURNS)

  const reset = () => {
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    pendingResolveRef.current = null
    pauseRequestedRef.current = false
    interruptedThisTurnRef.current = false
    resumeIndexRef.current = 0
    threadRef.current = null

    updateTimeline([])
    setThreadId(null)
    setPaused(false)
    setAwaitingHuman(false)
    setAwaitingHumanKind('plain')
  }

  const requestPause = () => {
    if (!running) return
    pauseRequestedRef.current = true
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    if (pendingResolveRef.current) {
      const resolve = pendingResolveRef.current
      pendingResolveRef.current = null
      resolve()
    }
  }

  const saveTimeline = async () => {
    const data = timelineRef.current
    if (!data.length) return
    await fetch('/api/save-timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
  }

  const goReview = (step) => {
    const tid = step?.threadId || threadRef.current || threadId
    if (!tid) return
    setCurrentThread({ userId: step?.userId || 'default', threadId: tid })
    navigateTo('review')
  }

  const recheckStep = async (stepIndex) => {
    const step = timelineRef.current[stepIndex]
    if (!step || step.type !== 'interrupted' || step.checking) return
    const tid = step.threadId || threadRef.current || threadId
    if (!tid) return

    updateTimeline(t => {
      const c = [...t]
      c[stepIndex] = { ...c[stepIndex], checking: true, recheckNote: null }
      return c
    })

    try {
      const state = await apiGetTaskPlanState(tid, step.userId || 'default')

      updateTimeline(t => {
        const c = [...t]
        if (state.is_awaiting_human) {
          const gateItems = state.pending_gate_items || []
          const { dominant, guardrailCount } = classifyGateItems(gateItems)
          c[stepIndex] = {
            ...c[stepIndex],
            checking: false,
            gateCount: gateItems.length,
            gateKind: dominant,
            recheckNote: {
              kind: 'still-waiting',
              text: dominant === 'guardrail'
                ? `仍在等待安全审核（${guardrailCount} 项待处理） · ${new Date().toLocaleTimeString()}`
                : `仍在等待人工审核（${gateItems.length} 项待处理） · ${new Date().toLocaleTimeString()}`,
            },
          }
        } else {
          const doneCount = (state.task_plan || []).filter(x => x.status === 'done').length
          const total = (state.task_plan || []).length
          const fallback = state.plan_status === 'aborted'
            ? '任务计划已在人工审核中被终止。'
            : `（人工审核已处理完毕，任务计划：${doneCount}/${total} 项完成）`
          const isAborted = state.plan_status === 'aborted'
          c[stepIndex] = {
            ...c[stepIndex],
            checking: false,
            type: isAborted ? 'err' : 'ai',
            label: isAborted
              ? String(c[stepIndex].label).replace(/安全审核中|等待人工审核/g, '已终止')
              : String(c[stepIndex].label).replace(/安全审核中|等待人工审核/g, 'AI 响应'),      
            content: state.answer || fallback,
            streaming: false,
            recheckNote: null,
            gateCount: undefined,
            gateKind: undefined,
          }
        }
        return c
      })

      if (!state.is_awaiting_human) {
        setAwaitingHuman(false)
      }
    } catch (e) {
      updateTimeline(t => {
        const c = [...t]
        c[stepIndex] = {
          ...c[stepIndex],
          checking: false,
          recheckNote: {
            kind: 'error',
            text: `刷新失败：${e.message || '请求出错'} · ${new Date().toLocaleTimeString()}`,
          },
        }
        return c
      })
    }
  }

  const run = async (resume = false) => {
    const validTurns = turns.map(t=>t.trim()).filter(Boolean)
    if (!validTurns.length || running) return
    if (resume && awaitingHuman) return

    setRunning(true)
    setPaused(false)
    setAwaitingHuman(false)
    pauseRequestedRef.current = false
    interruptedThisTurnRef.current = false

    let currentThread
    let startIndex

    if (resume) {
      currentThread = threadRef.current
      startIndex = resumeIndexRef.current
    } else {
      updateTimeline([])
      setThreadId(null)
      threadRef.current = null
      currentThread = null
      startIndex = 0
    }

    let allOk = true
    const sleep = ms => new Promise(r => setTimeout(r, ms))

    for (let i = startIndex; i < validTurns.length; i++) {
      interruptedThisTurnRef.current = false
      const q = validTurns[i]

      updateTimeline(t => [...t, { type:'user', label:`第 ${i+1} 轮 · 用户`, content:q }])

      if (i > startIndex && delay > 0) await sleep(delay)

      if (pauseRequestedRef.current) {
        updateTimeline(t => t.slice(0, -1))
        resumeIndexRef.current = i
        setPaused(true)
        setRunning(false)
        return
      }

      updateTimeline(t => [...t, { type:'ai', label:`第 ${i+1} 轮 · AI 响应`, content:'',
        streaming:true, ms:null }])

      const t0 = Date.now()
      await new Promise(resolve => {
        pendingResolveRef.current = resolve
        activeControllerRef.current = apiChatStream({
          question: q,
          thread_id: currentThread || '',
          onToken: (_, full) => {
            updateTimeline(t => {
              const c = [...t]
              c[c.length-1] = { ...c[c.length-1], content:full }
              return c
            })
          },
          onDone: (tid) => {
            pendingResolveRef.current = null
            if (tid) {
              currentThread = tid
              threadRef.current = tid
              setThreadId(tid)
              setCurrentThread({ userId: 'default', threadId: tid })
            }
            updateTimeline(t => {
              const c = [...t]
              c[c.length-1] = { ...c[c.length-1], streaming:false, ms:Date.now()-t0 }
              return c
            })
            resolve()
          },
          onError: (err) => {
            pendingResolveRef.current = null
            updateTimeline(t => {
              const c = [...t]
              c[c.length-1] = { type:'err', label:`第 ${i+1} 轮 · 错误`, content:err, streaming:false, ms:Date.now()-t0 }
              return c
            })
            allOk = false
            resolve()
          },
          onInterrupted: (payload, tid) => {
            pendingResolveRef.current = null
            if (tid) {
              currentThread = tid
              threadRef.current = tid
              setThreadId(tid)
              setCurrentThread({ userId: 'default', threadId: tid })
            }
            const gateItems = payload.pending_gate_items || []
            const { dominant } = classifyGateItems(gateItems)
            updateTimeline(t => {
              const c = [...t]
              c[c.length-1] = {
                type: 'interrupted',
                label: dominant === 'guardrail' ? `第 ${i+1} 轮 · 安全审核中` : `第 ${i+1} 轮 · 等待人工审核`,
                content: summarizeGateItems(gateItems),
                gateCount: gateItems.length,
                gateKind: dominant,
                threadId: tid || currentThread,
                userId: 'default',
                streaming: false,
                ms: Date.now() - t0,
              }
              return c
            })
            interruptedThisTurnRef.current = true
            resolve()
          },
          onRejected: (payload, tid) => {
            pendingResolveRef.current = null
            if (tid) {
              currentThread = tid
              threadRef.current = tid
              setThreadId(tid)
              setCurrentThread({ userId: 'default', threadId: tid })
            }
            const gateItems = payload.pending_gate_items || []
            const { dominant } = classifyGateItems(gateItems)
            updateTimeline(t => {
              const c = [...t]
              c[c.length-1] = {
                type: 'interrupted',
                label: dominant === 'guardrail' ? `第 ${i+1} 轮 · 安全审核中` : `第 ${i+1} 轮 · 等待人工审核`,
                content: payload.message || '当前会话存在未处理完的人工审核事项，请先处理完再发新消息。',
                gateCount: gateItems.length,
                gateKind: dominant,
                threadId: tid || currentThread,
                userId: 'default',
                streaming: false,
                ms: Date.now() - t0,
              }
              return c
            })
            interruptedThisTurnRef.current = true
            resolve()
          },
        })
      })
      activeControllerRef.current = null

      if (pauseRequestedRef.current) {
        if (!interruptedThisTurnRef.current) {
          updateTimeline(t => t.slice(0, -2))
          resumeIndexRef.current = i
          setPaused(true)
          setRunning(false)
          return
        }
      }

      if (interruptedThisTurnRef.current) {
        resumeIndexRef.current = i + 1
        setAwaitingHuman(true)
        // 刚写进 timeline 的最后一步就是这一轮的中断记录，直接读它的 gateKind
        setAwaitingHumanKind(timelineRef.current[timelineRef.current.length - 1]?.gateKind || 'plain')
        setPaused(false)
        setRunning(false)
        await saveTimeline()
        return
      }

      if (!allOk) break
    }

    resumeIndexRef.current = 0
    setPaused(false)
    setAwaitingHuman(false)
    await saveTimeline()
    setRunning(false)
  }

  const editingLocked = running || paused || awaitingHuman
  const hasResumePoint = resumeIndexRef.current > 0 && timeline.length > 0 && !running

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      <div style={styles.controls}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {awaitingHuman ? (
            <button
              disabled
              title={awaitingHumanKind === 'guardrail' ? '请先在「人工审核」处理完当前的安全策略拦截，再点卡片上的「刷新状态」' : '请先在「人工审核」处理完当前中断，再点卡片上的「刷新状态」'}
              style={{ ...styles.runBtn, opacity: 0.55, cursor: 'not-allowed' }}
            >
              <Play size={13}/> {awaitingHumanKind === 'guardrail' ? '等待安全审核…' : '等待人工审核…'}
            </button>
          ) : hasResumePoint ? (
            <button onClick={()=>run(true)} disabled={running} style={styles.runBtn}>
              <Play size={13}/> 继续（从第 {resumeIndexRef.current+1} 轮）
            </button>
          ) : (
            <button onClick={()=>run(false)} disabled={running || !turns.some(t=>t.trim())} style={styles.runBtn}>
              <Play size={13}/> {running ? '运行中…' : '开始多轮'}
            </button>
          )}

          {running && (
            <button onClick={requestPause} style={styles.pauseBtn}>
              <Pause size={13}/> 暂停
            </button>
          )}

          <button onClick={reset} disabled={running} style={styles.ghostBtn}>
            <RotateCcw size={13}/> 重置
          </button>
          <button onClick={loadExample} disabled={editingLocked} style={styles.ghostBtn}>
            载入示例
          </button>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={styles.label}>轮间延迟 ms</span>
            <input type="number" min={0} max={5000} step={100} value={delay}
              onChange={e=>setDelay(+e.target.value)} style={styles.numInput}/>
          </div>
          {threadId && (
            <div style={styles.threadBadge}>
              Thread: <code style={{ fontFamily:'var(--mono)' }}>{threadId}</code>
            </div>
          )}
          {paused && (
            <div style={styles.pausedBadge}>
              ⏸ 已暂停 · 将从第 {resumeIndexRef.current+1} 轮继续
            </div>
          )}
          {awaitingHuman && (
            <div style={awaitingHumanKind === 'guardrail' ? styles.guardrailBadge : styles.hitlBadge}>
              {awaitingHumanKind === 'guardrail'
                ? '🛡 安全策略拦截 · 处理完后请点时间线上的「刷新状态」'
                : '! 等待人工审核 · 处理完后请点时间线上的「刷新状态」'}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        <div style={styles.turnList}>
          <div style={styles.turnListHeader}>
            <span style={styles.label}>对话轮次</span>
            <button onClick={addTurn} disabled={editingLocked} style={styles.addBtn}><Plus size={12}/></button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'10px 14px', display:'flex', flexDirection:'column', gap:8 }}>
            {turns.map((t, i) => (
              <div key={i} style={{ display:'flex', gap:6, alignItems:'flex-start' }}>
                <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--sub)',
                  paddingTop:10, minWidth:20, textAlign:'right' }}>T{i+1}</span>
                <textarea
                  value={t}
                  onChange={e=>setTurn(i, e.target.value)}
                  placeholder={`第 ${i+1} 轮消息…`}
                  rows={2}
                  disabled={editingLocked}
                  style={styles.turnInput}
                />
                <button onClick={()=>delTurn(i)} disabled={editingLocked} style={styles.delBtn}>
                  <Trash2 size={11}/>
                </button>
              </div>
            ))}
          </div>
          <div style={{ padding:'8px 14px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
            <button onClick={addTurn} disabled={editingLocked} style={styles.addTurnBtn}>
              <Plus size={12}/> 添加轮次
            </button>
          </div>
        </div>

        <div style={styles.timeline}>
          {timeline.length === 0 && (
            <div style={styles.empty}>
              <div style={{ fontSize:28, marginBottom:8 }}>🔄</div>
              <div style={{ fontFamily:'var(--mono)', color:'var(--sub)', fontSize:13 }}>
                点击「开始多轮」查看对话时间线
              </div>
            </div>
          )}
          {timeline.map((step, i) => (
            <TimelineStep
              key={i}
              {...step}
              isStreaming={step.streaming}
              onGoReview={() => goReview(step)}
              onRecheck={() => recheckStep(i)}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

const styles = {
  controls: {
    padding:'12px 20px', borderBottom:'1px solid var(--border)', flexShrink:0,
  },
  runBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'7px 16px',
    background:'var(--accent)', border:'none', borderRadius:8,
    color:'#fff', cursor:'pointer', fontFamily:'var(--sans)', fontSize:13, fontWeight:500,
    transition:'all .15s',
  },
  pauseBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'7px 16px',
    background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.4)',
    borderRadius:8, color:'#f59e0b', cursor:'pointer',
    fontFamily:'var(--sans)', fontSize:13, fontWeight:500,
    transition:'all .15s',
  },
  ghostBtn: {
    display:'flex', alignItems:'center', gap:5, padding:'7px 12px',
    background:'var(--s2)', border:'1px solid var(--border)',
    borderRadius:8, color:'var(--sub)', cursor:'pointer',
    fontFamily:'var(--sans)', fontSize:12,
  },
  label: { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)' },
  numInput: {
    width:72, padding:'5px 8px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12, outline:'none',
  },
  threadBadge: {
    background:'rgba(91,156,246,.08)', border:'1px solid rgba(91,156,246,.2)',
    borderRadius:99, padding:'3px 12px', fontSize:11, color:'var(--accent)',
  },
  pausedBadge: {
    background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.35)',
    borderRadius:99, padding:'3px 12px', fontSize:11, color:'#f59e0b',
    fontFamily:'var(--mono)',
  },
  hitlBadge: {
    background:'rgba(251,191,36,.12)', border:'1px solid rgba(251,191,36,.4)',
    borderRadius:99, padding:'3px 12px', fontSize:11, color:'var(--warn)',
    fontFamily:'var(--mono)',
  },
  // ★ Guardrail 改动：安全策略拦截时的顶部提示条，红色调，跟 hitlBadge 区分开
  guardrailBadge: {
    background:'rgba(248,113,113,.12)', border:'1px solid rgba(248,113,113,.4)',
    borderRadius:99, padding:'3px 12px', fontSize:11, color:'var(--err)',
    fontFamily:'var(--mono)',
  },
  reviewBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
    background:'var(--warn)', border:'none', borderRadius:7,
    color:'#1a1206', fontSize:12, fontWeight:700, fontFamily:'var(--sans)', cursor:'pointer',
  },
  recheckBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
    background:'var(--s2)', border:'1px solid var(--border)', borderRadius:7,
    color:'var(--sub)', fontSize:12, fontWeight:600, fontFamily:'var(--sans)', cursor:'pointer',
  },
  turnList: {
    width:300, flexShrink:0, borderRight:'1px solid var(--border)',
    display:'flex', flexDirection:'column', overflow:'hidden',
  },
  turnListHeader: {
    padding:'10px 14px', borderBottom:'1px solid var(--border)',
    display:'flex', alignItems:'center', justifyContent:'space-between',
    flexShrink:0,
  },
  addBtn: {
    padding:4, background:'none', border:'none',
    color:'var(--sub)', cursor:'pointer', display:'flex',
  },
  turnInput: {
    flex:1, padding:'7px 10px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12,
    outline:'none', resize:'vertical', lineHeight:1.5, minHeight:56,
  },
  delBtn: {
    padding:5, background:'none', border:'none',
    color:'var(--sub)', cursor:'pointer', display:'flex', marginTop:6,
  },
  addTurnBtn: {
    display:'flex', alignItems:'center', gap:5, padding:'7px 10px',
    background:'none', border:'1px dashed var(--border)',
    borderRadius:8, color:'var(--sub)', cursor:'pointer',
    fontFamily:'var(--sans)', fontSize:12, width:'100%', justifyContent:'center',
  },
  timeline: {
    flex:1, overflowY:'auto', overflowX:'auto', padding:'20px',
    display:'flex', flexDirection:'column', gap:0,
  },
  empty: {
    flex:1, display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', textAlign:'center',
    color:'var(--sub)', margin:'auto',
  },
}

