'use client'
// components/ChatPanel.jsx
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'

import { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import { Send, StopCircle, Plus, Trash2 } from 'lucide-react'
import { apiChatStream, apiChat } from '../lib/client.js'

marked.setOptions({ breaks: true, gfm: true })

function MsgBubble({ role, content, ms }) {
  const isUser = role === 'user'
  const isErr  = role === 'error'
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
    setThreadId(`user_${Math.random().toString(36).slice(2,10)}`)
    setMessages([])
  }

  const clearChat = () => setMessages([])

  const send = () => {
    const q = input.trim()
    if (!q || streaming) return
    setInput('')
    taRef.current && (taRef.current.style.height = 'auto')

    const tid = threadId || `user_${Math.random().toString(36).slice(2,10)}`
    if (!threadId) setThreadId(tid)

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
          if (resolvedTid) setThreadId(resolvedTid)
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
      })
    } else {
      setStreaming(true)
      setMessages(m => [...m, { role:'ai', content:'', ms:null }])
      apiChat(q, tid)
        .then(res => {
          if (res.thread_id) setThreadId(res.thread_id)
          setMessages(m => {
            const copy = [...m]
            copy[copy.length-1] = { role:'ai', content:res.answer, ms:Date.now()-t0 }
            return copy
          })
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
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
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
          <MsgBubble key={i} role={m.role} content={m.content} ms={m.ms} />
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
