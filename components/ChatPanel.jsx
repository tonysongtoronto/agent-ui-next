'use client'
// components/ChatPanel.jsx
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'

import { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import { Send, StopCircle, Plus, Trash2, ClipboardCheck, ShieldQuestion, AlertTriangle, RefreshCw } from 'lucide-react'
import { apiChatStream, apiChat, apiGetTaskPlanState } from '../lib/client.js'
import { setCurrentThread, navigateTo } from '../lib/shared.js'
import { classifyGateItems, summarizeGateItems } from '../lib/guardrail.js'

marked.setOptions({ breaks: true, gfm: true })

// ★ Guardrail 改动：中断气泡原来统一用琥珀色 + "!" 图标（不区分"普通执行
//   失败需要人工重试"和"命中了安全策略"）。现在按 gateKind 区分：
//   'guardrail' → 红色调 + 盾牌图标，'plain' → 保持原来的琥珀色调
//   （老用户熟悉的视觉语言不变，避免每次重试都被当成"安全事件"一样吓到）。
// ★ HITL 改动：中断气泡新增「刷新状态」按钮 + recheckNote 提示，跟
//   BatchPanel（ResultCard）/MultiTurnPanel（TimelineStep）保持完全一致的
//   交互——用户去「人工审核」面板处理完之后，不用离开 Chat 页面、也不用
//   重新发一条消息，直接在原地点「刷新状态」重新查一次任务计划状态：
//     - 还在 waiting_human：气泡保持中断样式，更新最新的待办事项数量，
//       并给一条带时间戳的 recheckNote（哪怕数量没变化，也要有明确反馈）。
//     - 不再等待人工处理：气泡转成普通的最终回答（或终止提示），
//       复用 state.answer；没有的话退回到任务计划完成度的占位摘要。
function MsgBubble({ role, content, ms, gateCount, gateKind, checking, recheckNote, onGoReview, onRecheck }) {
  const isUser = role === 'user'
  const isErr  = role === 'error'
  const isInterrupted = role === 'interrupted'

  if (isInterrupted) {
    const isGuardrail = gateKind === 'guardrail'
    const tone = isGuardrail
      ? { bg: '#2d1515', border: '#5a2020', fg: 'var(--err)', boxBg: 'rgba(248,113,113,.08)', boxBorder: 'rgba(248,113,113,.3)', btnBg: 'var(--err)', btnFg: '#1a0a0a' }
      : { bg: '#3a2d10', border: '#6a5220', fg: 'var(--warn)', boxBg: 'rgba(251,191,36,.08)', boxBorder: 'rgba(251,191,36,.3)', btnBg: 'var(--warn)', btnFg: '#1a1206' }
    const Icon = isGuardrail ? ShieldQuestion : AlertTriangle

    return (
      <div className="fade-up" style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
        <div style={{
          width:28, height:28, borderRadius:7, display:'flex', alignItems:'center',
          justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, fontFamily:'var(--mono)',
          background:tone.bg, border:`1px solid ${tone.border}`, color:tone.fg,
        }}><Icon size={14} /></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{
            padding:'10px 14px', borderRadius:9, fontSize:13.5, lineHeight:1.75,
            background:tone.boxBg, border:`1px solid ${tone.boxBorder}`, color:'var(--text)',
            display:'flex', flexDirection:'column', gap:8,
          }}>
            {isGuardrail && (
              <span style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:tone.fg,
                textTransform:'uppercase', letterSpacing:'.04em' }}>安全策略拦截</span>
            )}
            <span>{content}</span>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <button onClick={onGoReview} style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'6px 12px', background:tone.btnBg, border:'none', borderRadius:7,
                color:tone.btnFg, fontSize:12, fontWeight:700, fontFamily:'var(--sans)', cursor:'pointer',
              }}>
                <ClipboardCheck size={13}/> 前往人工审核（{gateCount} 项）
              </button>
              <button
                onClick={onRecheck}
                disabled={checking}
                style={{
                  display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
                  background:'transparent', border:`1px solid ${tone.boxBorder}`, borderRadius:7,
                  color:tone.fg, fontSize:12, fontWeight:700, fontFamily:'var(--sans)',
                  cursor: checking ? 'default' : 'pointer', opacity: checking ? .65 : 1,
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
        </div>
      </div>
    )
  }

  return (
    <div className="fade-up" style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
      <div style={{
        width:28, height:28, borderRadius:7, display:'flex', alignItems:'center',
        justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, fontFamily:'var(--mono)',
        background: isUser ? '#1a2d50' : isErr ? '#2d1515' : 'linear-gradient(135deg,#141f3a,#0e1830)',
        border: isUser ? '1px solid #2a3a60' : isErr ? '1px solid #5a2020' : '1px solid #1e2d4a',
        color: isUser ? '#93c5fd' : isErr ? 'var(--err)' : 'var(--accent2)',
      }}>
        {isUser ? 'U' : isErr ? '!' : 'AI'}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{
          padding:'10px 14px', borderRadius:9, fontSize:13.5, lineHeight:1.75,
          background: isUser ? '#172040' : isErr ? '#2d1515' : 'var(--s2)',
          border: `1px solid ${isUser ? '#2a3a60' : isErr ? '#5a2020' : 'var(--border)'}`,
          color: isUser ? '#bfdbfe' : isErr ? 'var(--err)' : 'var(--text)',
        }}>
          {isUser
            ? <span style={{ whiteSpace:'pre-wrap' }}>{content}</span>
            : <div className="md-body" dangerouslySetInnerHTML={{ __html: marked.parse(content || '') }} />
          }
          {role === 'ai' && content === '' && (
            <span style={{ fontFamily:'var(--mono)', color:'var(--sub)', fontSize:12,
              animation:'blink 1s step-end infinite' }}>▋</span>
          )}
        </div>
        {ms != null && (
          <div style={{ marginTop:4, fontSize:11, color:'var(--sub)', fontFamily:'var(--mono)', paddingLeft:4 }}>{ms}ms</div>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel() {
  const [messages,  setMessages]  = useState([])
  const [input,     setInput]     = useState('')
  const [threadId,  setThreadId]  = useState('')
  const [streaming, setStreaming] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const ctrlRef   = useRef(null)
  const bottomRef = useRef(null)
  const taRef     = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [messages])

  const newSession = () => {
    const tid = `user_${Math.random().toString(36).slice(2,10)}`
    setThreadId(tid)
    setMessages([])
    // ★ HITL 改动：同步到共享存储，「人工审核」面板挂载时能自动带入这个会话
    setCurrentThread({ userId: 'default', threadId: tid })
  }

  const clearChat = () => setMessages([])

  // ★ HITL 改动：跳转到「人工审核」面板查看/处理这条消息命中的中断。
  //   跟 BatchPanel 的 goReview 是同一套机制——先把这条消息对应的
  //   thread_id/user_id 写进共享存储（lib/shared.js），TaskReviewPanel
  //   订阅了这个变更事件，会立刻重新拉取一次最新状态再展示。
  //   ★ Bugfix：之前这里只调用了 navigateTo('review')，没有显式
  //   setCurrentThread——虽然 send() 里已经调用过一次，但如果用户在中断
  //   发生前后没有触发过新的 thread 变更事件（同一个 thread_id 没变），
  //   TaskReviewPanel 就不会收到新的刷新通知，展示的是它上次挂载时缓存的
  //   旧状态（可能是任务规划刚开始、还没出现待办事项时查到的），导致
  //   「人工审核」页面显示"任务列表 (0)"、看起来是空的。这里改成每次点击
  //   都显式重新广播一次当前消息的 thread_id/user_id，确保跳转过去看到的
  //   一定是最新状态。
  const goReview = (msg) => {
    if (!msg.threadId) return
    setCurrentThread({ userId: msg.userId || 'default', threadId: msg.threadId })
    navigateTo('review')
  }

  // ★ HITL 改动：「刷新状态」——跟 BatchPanel 的 recheckItem / MultiTurnPanel
  //   的同名逻辑保持一致，复用同一个 GET /session/{user}/{thread}/state 接口：
  //     - 还在 waiting_human：气泡保持中断样式，更新最新的待办事项数量，
  //       并给一条带时间戳的 recheckNote（哪怕数量没变化，也要有明确反馈，
  //       让用户确认"刚才那次点击确实生效了"）。
  //     - 不再等待人工处理：视为这轮对话已经跑完，把气泡转成普通的最终
  //       回答（或终止提示），优先用后端给的真实回答文本 state.answer，
  //       拿不到时才退回到任务计划完成度的占位摘要。
  const recheckMessage = async (idx) => {
    const msg = messages[idx]
    if (!msg?.threadId || msg.checking) return
    setMessages(m => { const c=[...m]; c[idx]={...c[idx],checking:true,recheckNote:null}; return c })
    try {
      const state = await apiGetTaskPlanState(msg.threadId, msg.userId || 'default')
      setMessages(m => {
        const c=[...m]
        if (state.is_awaiting_human) {
          const gateItems = state.pending_gate_items || []
          const { dominant, guardrailCount } = classifyGateItems(gateItems)
          c[idx] = {
            ...c[idx], checking:false, gateCount: gateItems.length, gateKind: dominant,
            content: summarizeGateItems(gateItems),
            recheckNote: {
              kind:'still-waiting',
              text: dominant === 'guardrail'
                ? `仍在等待安全审核（${guardrailCount} 项待处理） · ${new Date().toLocaleTimeString()}`
                : `仍在等待人工审核（${gateItems.length} 项待处理） · ${new Date().toLocaleTimeString()}`,
            },
          }
        } else {
          const doneCount = (state.task_plan||[]).filter(t=>t.status==='done').length
          const total = (state.task_plan||[]).length
          const fallback = state.plan_status === 'aborted'
            ? '任务计划已在人工审核中被终止。'
            : `（人工审核已处理完毕，任务计划：${doneCount}/${total} 项完成）`
          c[idx] = {
            ...c[idx],
            role: state.plan_status === 'aborted' ? 'error' : 'ai',
            checking:false,
            content: state.answer || fallback,
            recheckNote: null,
          }
        }
        return c
      })
    } catch (e) {
      setMessages(m => {
        const c=[...m]
        c[idx]={...c[idx],checking:false,recheckNote:{ kind:'error', text:`刷新失败：${e.message || '请求出错'} · ${new Date().toLocaleTimeString()}` }}
        return c
      })
    }
  }

  const send = () => {
    const q = input.trim()
    if (!q || streaming) return
    setInput('')
    taRef.current && (taRef.current.style.height = 'auto')

    const tid = threadId || `user_${Math.random().toString(36).slice(2,10)}`
    if (!threadId) setThreadId(tid)
    setCurrentThread({ userId: 'default', threadId: tid })

    setMessages(m => [...m, { role:'user', content:q }])
    const t0 = Date.now()

    if (useStream) {
      setStreaming(true)
      setMessages(m => [...m, { role:'ai', content:'', ms:null }])

      ctrlRef.current = apiChatStream({
        question: q, thread_id: tid,
        onToken: (_, full) => {
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = { role:'ai', content:full, ms:null }
            return copy
          })
        },
        onDone: (resolvedTid) => {
          if (resolvedTid) { setThreadId(resolvedTid); setCurrentThread({ threadId: resolvedTid }) }
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = { ...copy[copy.length-1], ms: Date.now()-t0 }
            return copy
          })
          setStreaming(false)
        },
        onError: (err) => {
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = { role:'error', content:err, ms: Date.now()-t0 }
            return copy
          })
          setStreaming(false)
        },
        // ★ HITL 改动：本轮请求被 human_review_gate 的 interrupt() 冻结了，
        //   不是正常回答完成。把占位的空 AI 气泡换成一条特殊的"中断提示"气泡，
        //   而不是留一个永远转圈/空白的气泡在那里。
        // ★ HITL 改动：_consumeSSE 把 resolvedThreadId 作为第二个参数传回来
        //   （见 lib/client.js），记录到消息上，供「前往人工审核」/「刷新
        //   状态」使用——不能依赖闭包里的 tid 变量，因为全新会话时后端才是
        //   thread_id 的最终来源（本地生成的 tid 只是请求时的占位）。
        onInterrupted: (payload, resolvedTid) => {
          const gateItems = payload.pending_gate_items || []
          const { dominant } = classifyGateItems(gateItems)
          const finalTid = resolvedTid || tid
          setThreadId(finalTid)
          setCurrentThread({ userId: 'default', threadId: finalTid })
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = {
              role: 'interrupted',
              content: summarizeGateItems(gateItems),
              gateCount: gateItems.length,
              gateKind: dominant,
              threadId: finalTid,
              userId: 'default',
            }
            return copy
          })
          setStreaming(false)
        },
        // ★ HITL 改动：上一轮还冻结在人工审核上，这一轮请求被后端 409 拒绝
        onRejected: (payload, resolvedTid) => {
          const gateItems = payload.pending_gate_items || []
          const { dominant } = classifyGateItems(gateItems)
          const finalTid = resolvedTid || tid
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = {
              role: 'interrupted',
              content: payload.message || '当前会话存在未处理完的人工审核事项，请先处理完再发新消息。',
              gateCount: gateItems.length,
              gateKind: dominant,
              threadId: finalTid,
              userId: 'default',
            }
            return copy
          })
          setStreaming(false)
        },
      })
    } else {
      setStreaming(true)
      setMessages(m => [...m, { role:'ai', content:'', ms:null }])
      apiChat(q, tid)
        .then(res => {
          if (res.thread_id) { setThreadId(res.thread_id); setCurrentThread({ threadId: res.thread_id }) }

          // ★ 改动：rejected（上一轮还冻结在人工审核，本轮请求被后端 409 拒绝）
          //   跟 interrupted 分开判断，走同一套「中断提示」气泡，
          //   文案直接用后端/client.js 给的 res.message。
          if (res.rejected) {
            const { dominant } = classifyGateItems(res.gateItems || [])
            setMessages(m => {
              const copy = [...m]
              copy[copy.length-1] = {
                role: 'interrupted',
                content: res.message || '当前会话存在未处理完的人工审核事项，请先处理完再发新消息。',
                gateCount: (res.gateItems || []).length,
                gateKind: dominant,
                threadId: res.thread_id || tid,
                userId: 'default',
              }
              return copy
            })
          } else if (res.interrupted) {
            const { dominant } = classifyGateItems(res.gateItems || [])
            setMessages(m => {
              const copy = [...m]
              copy[copy.length-1] = {
                role: 'interrupted',
                content: summarizeGateItems(res.gateItems || []),
                gateCount: res.gateItems.length,
                gateKind: dominant,
                threadId: res.thread_id || tid,
                userId: 'default',
              }
              return copy
            })
          } else {
            setMessages(m => {
              const copy = [...m]
              copy[copy.length-1] = { role:'ai', content:res.answer, ms:Date.now()-t0 }
              return copy
            })
          }
        })
        .catch(err => {
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = { role:'error', content:err.message, ms:Date.now()-t0 }
            return copy
          })
        })
        .finally(() => setStreaming(false))
    }
  }

  const stop = () => { ctrlRef.current?.abort(); setStreaming(false) }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const autoResize = (e) => {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {/* Thread ID bar */}
      <div style={styles.threadBar}>
        <span style={styles.threadLabel}>Thread ID</span>
        <input value={threadId} onChange={e => setThreadId(e.target.value)}
          placeholder="留空自动分配" style={styles.threadInput} />
        <button onClick={newSession} style={styles.iconBtn}><Plus size={14} /> 新会话</button>
        <button onClick={clearChat} style={styles.iconBtn}><Trash2 size={14} /> 清空</button>
        <label style={styles.toggleWrap}>
          <div style={{ ...styles.toggle, background: useStream ? 'var(--accent)' : 'var(--border2)' }}
            onClick={() => setUseStream(v=>!v)}>
            <div style={{ ...styles.toggleKnob, transform: useStream ? 'translateX(14px)' : 'none' }} />
          </div>
          <span style={{ fontSize:11, color:'var(--sub)', fontFamily:'var(--mono)' }}>
            {useStream ? 'Stream' : 'Sync'}
          </span>
        </label>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            <div style={{ fontSize:32, marginBottom:10 }}>💬</div>
            <div style={{ fontFamily:'var(--mono)', color:'var(--sub)', fontSize:13 }}>发送消息开始对话</div>
            <div style={{ marginTop:6, color:'var(--border2)', fontSize:12 }}>支持 Markdown · 多轮记忆 · 流式输出</div>
          </div>
        )}
        {messages.map((m, i) => (
          <MsgBubble key={i} role={m.role} content={m.content} ms={m.ms}
            gateCount={m.gateCount} gateKind={m.gateKind}
            checking={m.checking} recheckNote={m.recheckNote}
            onGoReview={() => goReview(m)} onRecheck={() => recheckMessage(i)} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={styles.inputArea}>
        <textarea ref={taRef} value={input}
          onChange={e => { setInput(e.target.value); autoResize(e) }}
          onKeyDown={onKey}
          placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
          rows={1} style={styles.textarea} disabled={streaming}
        />
        {streaming
          ? <button onClick={stop} style={styles.stopBtn}><StopCircle size={18} /></button>
          : <button onClick={send} disabled={!input.trim()} style={styles.sendBtn}><Send size={16} /></button>
        }
      </div>
    </div>
  )
}

const styles = {
  threadBar: {
    display:'flex', alignItems:'center', gap:8, padding:'10px 20px',
    borderBottom:'1px solid var(--border)', flexShrink:0, flexWrap:'wrap',
  },
  threadLabel: {
    fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)',
    fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', whiteSpace:'nowrap',
  },
  threadInput: {
    flex:1, minWidth:120, padding:'5px 10px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7, color:'var(--text)',
    fontFamily:'var(--mono)', fontSize:12, outline:'none',
  },
  iconBtn: {
    display:'flex', alignItems:'center', gap:5, padding:'5px 10px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7, color:'var(--sub)', fontSize:12,
    fontFamily:'var(--sans)', cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s',
  },
  toggleWrap: { display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none' },
  toggle: { width:30, height:16, borderRadius:99, position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 },
  toggleKnob: { position:'absolute', top:2, left:2, width:12, height:12, borderRadius:'50%', background:'#fff', transition:'transform .2s' },
  messages: { flex:1, overflowY:'auto', padding:'20px', display:'flex', flexDirection:'column', gap:14 },
  empty: {
    flex:1, display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', margin:'auto', textAlign:'center', padding:40,
  },
  inputArea: {
    display:'flex', gap:10, padding:'14px 20px',
    borderTop:'1px solid var(--border)', flexShrink:0, alignItems:'flex-end',
  },
  textarea: {
    flex:1, padding:'10px 14px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:'var(--r)',
    color:'var(--text)', fontFamily:'var(--sans)', fontSize:13.5,
    outline:'none', resize:'none', lineHeight:1.6,
    transition:'border-color .2s, box-shadow .2s', minHeight:42,
  },
  sendBtn: {
    width:42, height:42, borderRadius:'var(--r)', background:'var(--accent)',
    border:'none', color:'#fff', cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center',
    transition:'all .15s', flexShrink:0,
  },
  stopBtn: {
    width:42, height:42, borderRadius:'var(--r)',
    background:'rgba(248,113,113,.15)', border:'1px solid rgba(248,113,113,.3)',
    color:'var(--err)', cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
  },
}