'use client'
// components/BatchPanel.jsx — Next.js 版本
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'
import { useState, useRef } from 'react'
import { marked } from 'marked'
import { Plus, Play, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { apiChatStream } from '../lib/client.js'

const PRESETS = [
  '你好，我叫 Tony，今年 28 岁，住在多伦多',
  '计算 99 × 99，同时访问 https://api.github.com/zen',
  '用一段话介绍一下量子计算',
  '写一首关于秋天的五言绝句',
]

function ResultCard({ item, idx }) {
  const [open, setOpen] = useState(true)
  const statusColor = { pending:'var(--sub)', running:'var(--warn)', done:'var(--ok)', error:'var(--err)' }
  const statusLabel = { pending:'等待中', running:'运行中', done:'完成', error:'失败' }

  return (
    <div style={{
      ...styles.card,
      borderColor: item.status === 'error' ? 'rgba(248,113,113,.3)'
                 : item.status === 'done'  ? 'rgba(52,211,153,.2)'
                 : 'var(--border)',
    }} className="fade-up">
      <div style={styles.cardHead} onClick={() => setOpen(v=>!v)}>
        <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', minWidth:24 }}>
          #{String(idx+1).padStart(2,'0')}
        </span>
        <span style={{ flex:1, fontSize:13, color:'var(--text)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {item.question}
        </span>
        <span style={{ fontFamily:'var(--mono)', fontSize:11,
          color: statusColor[item.status], whiteSpace:'nowrap' }}>
          {item.status === 'running' && <span style={{ animation:'spin .6s linear infinite', display:'inline-block', marginRight:4 }}>◌</span>}
          {statusLabel[item.status]}
        </span>
        {item.ms && <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--sub)', whiteSpace:'nowrap' }}>{item.ms}ms</span>}
        {open ? <ChevronUp size={13} color="var(--sub)"/> : <ChevronDown size={13} color="var(--sub)"/>}
      </div>

      {open && item.answer && (
        <div style={styles.cardBody}>
          <div className="md-body" dangerouslySetInnerHTML={{ __html: marked.parse(item.answer) }} />
        </div>
      )}
      {open && item.status === 'error' && item.answer && (
        <div style={{ padding:'10px 14px', color:'var(--err)', fontFamily:'var(--mono)', fontSize:12 }}>
          ✗ {item.answer}
        </div>
      )}
    </div>
  )
}

export default function BatchPanel() {
  const [cases,    setCases]    = useState(PRESETS.map(q => q))
  const [results,  setResults]  = useState([])
  const [running,  setRunning]  = useState(false)
  const [mode,     setMode]     = useState('seq') // seq | par
  const [concur,   setConcur]   = useState(3)
  const abortRef = useRef([])

  const addCase = () => setCases(c => [...c, ''])
  const delCase = (i) => setCases(c => c.filter((_,j)=>j!==i))
  const setCase = (i, v) => setCases(c => c.map((x,j)=>j===i?v:x))

  const stop = () => {
    abortRef.current.forEach(c => c?.abort())
    setRunning(false)
  }

  const run = async () => {
    const qs = cases.map(q=>q.trim()).filter(Boolean)
    if (!qs.length) return
    setRunning(true)
    abortRef.current = []

    const init = qs.map(q => ({ question:q, status:'pending', answer:'', ms:null }))
    setResults(init)

    const runOne = (q, i) => new Promise(resolve => {
      const t0 = Date.now()
      setResults(r => { const c=[...r]; c[i]={...c[i],status:'running'}; return c })

      const ctrl = apiChatStream({
        question: q, thread_id: '',
        onToken: (_, full) => {
          setResults(r => { const c=[...r]; c[i]={...c[i],answer:full}; return c })
        },
        onDone: () => {
          setResults(r => { const c=[...r]; c[i]={...c[i],status:'done',ms:Date.now()-t0}; return c })
          resolve()
        },
        onError: (err) => {
          setResults(r => { const c=[...r]; c[i]={...c[i],status:'error',answer:err,ms:Date.now()-t0}; return c })
          resolve()
        },
      })
      abortRef.current[i] = ctrl
    })

    if (mode === 'seq') {
      for (let i = 0; i < qs.length; i++) await runOne(qs[i], i)
    } else {
      for (let i = 0; i < qs.length; i += concur)
        await Promise.all(qs.slice(i, i+concur).map((q,j) => runOne(q, i+j)))
    }
    setRunning(false)
  }

  const done   = results.filter(r=>r.status==='done').length
  const failed = results.filter(r=>r.status==='error').length

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* Config */}
      <div style={styles.config}>
        <div style={styles.modeRow}>
          {['seq','par'].map(m => (
            <button key={m} onClick={()=>setMode(m)} style={{
              ...styles.modeBtn,
              background: mode===m ? 'var(--accent)' : 'var(--s2)',
              color: mode===m ? '#fff' : 'var(--sub)',
              border: `1px solid ${mode===m ? 'transparent' : 'var(--border)'}`,
            }}>
              {m === 'seq' ? '顺序执行' : '并行执行'}
            </button>
          ))}
          {mode === 'par' && (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={styles.label}>并发数</span>
              <input type="number" min={1} max={10} value={concur}
                onChange={e=>setConcur(+e.target.value)}
                style={{ ...styles.numInput }} />
            </div>
          )}
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            {running
              ? <button onClick={stop} style={styles.stopBtn}>⏹ 停止</button>
              : <button onClick={run} disabled={!cases.some(q=>q.trim())} style={styles.runBtn}>
                  <Play size={13}/> 运行全部 
                </button>
            }
            <button onClick={addCase} style={styles.ghostBtn}><Plus size={13}/> 添加</button>
            <button onClick={()=>{setResults([]);setCases(PRESETS.map(q=>q))}} style={styles.ghostBtn}>
              重置
            </button>
          </div>
        </div>

        {/* Progress */}
        {results.length > 0 && (
          <div style={styles.progress}>
            <div style={styles.progressBar}>
              <div style={{
                height:'100%', borderRadius:99, transition:'width .3s',
                background:`linear-gradient(90deg, var(--ok), var(--accent2))`,
                width: `${(done/results.length)*100}%`,
              }}/>
            </div>
            <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', whiteSpace:'nowrap' }}>
              {done}/{results.length} 完成 {failed>0 && <span style={{color:'var(--err)'}}> · {failed} 失败</span>}
            </span>
          </div>
        )}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', display:'flex', flexDirection:'column', gap:10 }}>
        {/* Case inputs (only shown when not running) */}
        {results.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {cases.map((q, i) => (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', minWidth:24 }}>#{i+1}</span>
                <input
                  value={q}
                  onChange={e => setCase(i, e.target.value)}
                  placeholder="输入测试用例…"
                  style={styles.caseInput}
                />
                <button onClick={()=>delCase(i)} style={styles.delBtn}><Trash2 size={12}/></button>
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {results.map((r, i) => <ResultCard key={i} item={r} idx={i} />)}
      </div>
    </div>
  )
}

const styles = {
  config: {
    padding:'12px 20px', borderBottom:'1px solid var(--border)',
    display:'flex', flexDirection:'column', gap:10, flexShrink:0,
  },
  modeRow: { display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' },
  modeBtn: {
    padding:'6px 14px', borderRadius:8, cursor:'pointer',
    fontFamily:'var(--mono)', fontSize:12, fontWeight:500, transition:'all .15s',
  },
  label: { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)' },
  numInput: {
    width:52, padding:'5px 8px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12, outline:'none',
  },
  runBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'6px 14px',
    background:'var(--accent)', border:'none', borderRadius:8,
    color:'#fff', cursor:'pointer', fontFamily:'var(--sans)', fontSize:13, fontWeight:500,
  },
  stopBtn: {
    padding:'6px 14px', background:'rgba(248,113,113,.15)',
    border:'1px solid rgba(248,113,113,.3)', borderRadius:8,
    color:'var(--err)', cursor:'pointer', fontFamily:'var(--sans)', fontSize:13,
  },
  ghostBtn: {
    display:'flex', alignItems:'center', gap:5, padding:'6px 12px',
    background:'var(--s2)', border:'1px solid var(--border)',
    borderRadius:8, color:'var(--sub)', cursor:'pointer',
    fontFamily:'var(--sans)', fontSize:12,
  },
  progress: { display:'flex', alignItems:'center', gap:10 },
  progressBar: {
    flex:1, height:4, background:'var(--border)', borderRadius:99, overflow:'hidden',
  },
  card: {
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:'var(--r)', overflow:'hidden',
  },
  cardHead: {
    display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
    cursor:'pointer', userSelect:'none',
  },
  cardBody: {
    padding:'12px 14px', borderTop:'1px solid var(--border)',
    background:'var(--s2)',
  },
  caseInput: {
    flex:1, padding:'8px 12px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5, outline:'none',
  },
  delBtn: {
    padding:6, background:'none', border:'none',
    color:'var(--sub)', cursor:'pointer', display:'flex',
  },
}
