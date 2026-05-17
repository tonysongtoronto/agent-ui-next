'use client'
// components/MultiTurnPanel.jsx — Next.js 版本
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'
import { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import { Plus, Play, RotateCcw, Trash2 } from 'lucide-react'
import { apiChatStream } from '../lib/client.js'

const EXAMPLE_TURNS = [
  '你好！我叫 Lily，今年 30 岁，住在温哥华，是一名 UI 设计师。',
  '请复述一下我刚才告诉你的信息。',
  '我最近在学 Python，目标是转行做数据分析。',
  '根据我的背景，推荐三本学习书籍。',
]

function TimelineStep({ type, label, content, ms, isStreaming }) {
  const dotStyle = {
    user: { bg:'#1a2d50', border:'#2a3a60', color:'#93c5fd', label:'U' },
    ai:   { bg:'#111827', border:'#1e2d4a', color:'var(--accent2)', label:'AI' },
    err:  { bg:'#2d1515', border:'#5a2020', color:'var(--err)', label:'!' },
  }[type] || { bg:'var(--s2)', border:'var(--border)', color:'var(--sub)', label:'?' }

  return (
    <div className="slide-in" style={{ display:'flex', gap:14 }}>
      {/* Dot + line */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
        <div style={{
          width:28, height:28, borderRadius:7, display:'flex', alignItems:'center',
          justifyContent:'center', fontSize:11, fontWeight:700,
          background:dotStyle.bg, border:`1px solid ${dotStyle.border}`, color:dotStyle.color,
          fontFamily:'var(--mono)',
        }}>{dotStyle.label}</div>
        <div style={{ flex:1, width:1, background:'var(--border)', marginTop:4 }} />
      </div>

      {/* Content */}
      <div style={{ flex:1, paddingBottom:16, minWidth:0 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--sub)',
          marginBottom:6, textTransform:'uppercase', letterSpacing:'.06em' }}>
          {label}
          {ms && <span style={{ marginLeft:8, color:'var(--border2)' }}>{ms}ms</span>}
        </div>
        <div style={{
          background: type==='user' ? '#172040' : type==='err' ? '#2d1515' : 'var(--s2)',
          border:`1px solid ${type==='user' ? '#2a3a60' : type==='err' ? '#5a2020' : 'var(--border)'}`,
          borderRadius:9, padding:'10px 14px', fontSize:13.5, lineHeight:1.75,
          color: type==='user' ? '#bfdbfe' : type==='err' ? 'var(--err)' : 'var(--text)',
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
      </div>
    </div>
  )
}

export default function MultiTurnPanel() {
  const [turns,    setTurns]    = useState(EXAMPLE_TURNS)
  const [timeline, setTimeline] = useState([])
  const [threadId, setThreadId] = useState(null)
  const [running,  setRunning]  = useState(false)
  const [delay,    setDelay]    = useState(0)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [timeline])

  const addTurn  = () => setTurns(t => [...t, ''])
  const delTurn  = (i) => setTurns(t => t.filter((_,j)=>j!==i))
  const setTurn  = (i, v) => setTurns(t => t.map((x,j)=>j===i?v:x))
  const loadExample = () => setTurns(EXAMPLE_TURNS)
  const reset    = () => { setTimeline([]); setThreadId(null) }

  const run = async () => {
    const validTurns = turns.map(t=>t.trim()).filter(Boolean)
    if (!validTurns.length || running) return

    setRunning(true)
    setTimeline([])
    setThreadId(null)
    let currentThread = null
    let allOk = true

    const sleep = ms => new Promise(r => setTimeout(r, ms))

    for (let i = 0; i < validTurns.length; i++) {
      const q = validTurns[i]

      // Add user message
      setTimeline(t => [...t, { type:'user', label:`第 ${i+1} 轮 · 用户`, content:q }])

      if (i > 0 && delay > 0) await sleep(delay)

      // Add AI placeholder
      const aiIdx = (i * 2) + 1
      setTimeline(t => [...t, { type:'ai', label:`第 ${i+1} 轮 · AI 响应`, content:'', streaming:true, ms:null }])

      const t0 = Date.now()
      await new Promise(resolve => {
        apiChatStream({
          question: q,
          thread_id: currentThread || '',
          onToken: (_, full) => {
            setTimeline(t => {
              const c = [...t]
              c[c.length-1] = { ...c[c.length-1], content:full }
              return c
            })
          },
          onDone: (tid) => {
            if (tid) { currentThread = tid; setThreadId(tid) }
            setTimeline(t => {
              const c = [...t]
              c[c.length-1] = { ...c[c.length-1], streaming:false, ms:Date.now()-t0 }
              return c
            })
            resolve()
          },
          onError: (err) => {
            setTimeline(t => {
              const c = [...t]
              c[c.length-1] = { type:'err', label:`第 ${i+1} 轮 · 错误`, content:err, streaming:false, ms:Date.now()-t0 }
              return c
            })
            allOk = false
            resolve()
          },
        })
      })

      if (!allOk) break
    }

    setRunning(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={run} disabled={running || !turns.some(t=>t.trim())} style={styles.runBtn}>
            <Play size={13}/> {running ? '运行中…' : '开始多轮'}
          </button>
          <button onClick={reset} disabled={running} style={styles.ghostBtn}>
            <RotateCcw size={13}/> 重置
          </button>
          <button onClick={loadExample} disabled={running} style={styles.ghostBtn}>
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
        </div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Turn list (left panel) */}
        <div style={styles.turnList}>
          <div style={styles.turnListHeader}>
            <span style={styles.label}>对话轮次</span>
            <button onClick={addTurn} style={styles.addBtn}><Plus size={12}/></button>
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
                  disabled={running}
                  style={styles.turnInput}
                />
                <button onClick={()=>delTurn(i)} disabled={running} style={styles.delBtn}>
                  <Trash2 size={11}/>
                </button>
              </div>
            ))}
            <button onClick={addTurn} style={styles.addTurnBtn}>
              <Plus size={12}/> 添加轮次
            </button>
          </div>
        </div>

        {/* Timeline (right panel) */}
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
            <TimelineStep key={i} {...step} isStreaming={step.streaming} />
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
    flex:1, overflowY:'auto', padding:'20px',
    display:'flex', flexDirection:'column', gap:0,
  },
  empty: {
    flex:1, display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', textAlign:'center',
    color:'var(--sub)', margin:'auto',
  },
}
