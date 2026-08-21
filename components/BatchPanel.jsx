'use client'
// components/BatchPanel.jsx — Next.js 版本
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'
// 2024 修改：支持"暂停"状态 + 再次运行时从暂停处继续（顺序/并行都支持）
// ★ HITL 改动：批量测试里的每一条用例现在也可能命中 human_review_gate 的
//   interrupt()，或者（理论上）撞上 409 rejected。之前 apiChatStream() 调用
//   完全没接 onInterrupted/onRejected，导致：
//     1. 命中中断的那条用例的 Promise 永远不 resolve —— 顺序模式下会把
//        整条批量队列卡死，并行模式下会让那个并发槽位永久占用。
//     2. 就算用别的手段绕过卡死，用户在 Batch Test 页面也完全看不出
//        这条用例其实是"等待人工审核"，而不是"失败"或者"还在跑"。
//   这里补齐跟 ChatPanel 完全一致的语义：新增 'interrupted' 状态，
//   记录该条用例对应的 thread_id/user_id，提供「前往人工审核」跳转
//   （复用 lib/shared.js 的 setCurrentThread + navigateTo，跟 ChatPanel
//   的中断气泡是同一套机制），以及一个「刷新状态」按钮（复用
//   apiGetTaskPlanState，跟 useAwaitingHuman 轮询用的是同一个接口）
//   方便用户在 Review 面板处理完之后回来确认这条用例的最终状态，
//   而不用离开 Batch Test 页面去 Chat 面板核对。
import { useState, useRef } from 'react'
import { marked } from 'marked'
import { Plus, Play, Trash2, ChevronDown, ChevronUp, ClipboardCheck, RefreshCw } from 'lucide-react'
import { apiChatStream, apiGetTaskPlanState } from '../lib/client.js'
import { setCurrentThread, navigateTo } from '../lib/shared.js'

const PRESETS = [
  '你好，我叫 Tony，今年 28 岁，住在多伦多',
  '计算 99 × 99，同时访问 https://api.github.com/zen',
  '用一段话介绍一下量子计算',
  '写一首关于秋天的五言绝句',
]

function ResultCard({ item, idx, onGoReview, onRecheck }) {
  const [open, setOpen] = useState(true)
  const isInterrupted = item.status === 'interrupted'
  const statusColor = { pending:'var(--sub)', running:'var(--warn)', done:'var(--ok)', error:'var(--err)', paused:'var(--sub)', interrupted:'var(--warn)' }
  const statusLabel = { pending:'等待中', running:'运行中', done:'完成', error:'失败', paused:'已暂停', interrupted:'等待人工审核' }

  return (
    <div style={{
      ...styles.card,
      borderColor: item.status === 'error' ? 'rgba(248,113,113,.3)'
                 : item.status === 'done'  ? 'rgba(52,211,153,.2)'
                 : item.status === 'paused' ? 'rgba(148,163,184,.3)'
                 : isInterrupted ? 'rgba(251,191,36,.35)'
                 : 'var(--border)',
    }} className="fade-up">
      <div style={styles.cardHead} onClick={() => setOpen(v=>!v)}>
        <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)', minWidth:24 }}>
          #{String(idx+1).padStart(2,'0')}
        </span>
        <span style={{ flex:1, minWidth:0, fontSize:13, color:'var(--text)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {item.question}
        </span>
        <span style={{ fontFamily:'var(--mono)', fontSize:11,
          color: statusColor[item.status], whiteSpace:'nowrap' }}>
          {item.status === 'running' && <span style={{ animation:'spin .6s linear infinite', display:'inline-block', marginRight:4 }}>◌</span>}
          {item.status === 'paused' && <span style={{ display:'inline-block', marginRight:4 }}>⏸</span>}
          {isInterrupted && <span style={{ display:'inline-block', marginRight:4 }}>!</span>}
          {statusLabel[item.status]}
        </span>
        {item.ms && <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--sub)', whiteSpace:'nowrap' }}>{item.ms}ms</span>}
        {open ? <ChevronUp size={13} color="var(--sub)"/> : <ChevronDown size={13} color="var(--sub)"/>}
      </div>

      {/* ★ HITL 改动：命中 interrupt() 冻结 / 409 rejected 时，跟 ChatPanel 里
          的中断气泡展示同一段文案 + 同一个「前往人工审核」跳转，外加一个
          「刷新状态」按钮，方便在 Review 面板处理完之后回来这里确认结果。 */}
      {open && isInterrupted && (
        <div style={styles.interruptedBox}>
          <span>{item.message}</span>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <button onClick={(e) => { e.stopPropagation(); onGoReview(item) }} style={styles.reviewBtn}>
              <ClipboardCheck size={13}/> 前往人工审核（{item.gateCount} 项）
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRecheck(idx) }}
              disabled={item.checking}
              style={{ ...styles.recheckBtn, opacity: item.checking ? .65 : 1, cursor: item.checking ? 'default' : 'pointer' }}
            >
              <RefreshCw size={13} style={{ animation: item.checking ? 'spin .6s linear infinite' : 'none' }}/>
              {item.checking ? '正在检查…' : '刷新状态'}
            </button>
            {/* ★ Bugfix：不管检查结果有没有变化，都给一条明确、带时间戳的
                反馈，让用户确认"刚才那次点击确实生效了"。 */}
            {item.recheckNote && (
              <span style={{
                fontSize:11, fontFamily:'var(--mono)',
                color: item.recheckNote.kind === 'error' ? 'var(--err)' : 'var(--sub)',
              }}>
                {item.recheckNote.kind === 'error' ? '✗ ' : '✓ '}{item.recheckNote.text}
              </span>
            )}
          </div>
        </div>
      )}

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

  // ★ HITL 改动：跳转到「人工审核」面板查看/处理这条用例命中的中断。
  //   跟 ChatPanel 的 onGoReview 是同一套机制——先把这条用例对应的
  //   thread_id/user_id 写进共享存储（lib/shared.js），Review 面板挂载
  //   时会自动读取；再广播导航事件让 AppShell 切到 review 标签页。
  const goReview = (item) => {
    if (!item.threadId) return
    setCurrentThread({ userId: item.userId || 'default', threadId: item.threadId })
    navigateTo('review')
  }

  // ★ HITL 改动：用户去 Review 面板处理完这条用例的中断之后，回到 Batch
  //   页面点「刷新状态」，重新查一次任务计划状态（跟 useAwaitingHuman 轮询
  //   用的是同一个 GET /session/{user}/{thread}/state 接口）：
  //     - 还在 waiting_human：保持 interrupted，更新最新的待办事项数量
  //     - 不再等待人工处理：视为该用例已跑完，转成 done（没有单独的最终
  //       回答文本可用，就用任务计划状态拼一句摘要展示）
  // ★ Bugfix：之前点「刷新状态」时，如果查询结果仍然是"还在等待人工审核"
  //   （最常见的情况——用户还没在 Review 面板处理完），代码只是悄悄把
  //   gateCount 更新一下（多数情况下数值根本没变），checking 状态又只在
  //   请求这几百毫秒内为 true（转圈动画一晃就没了，几乎看不见），卡片
  //   整体看起来跟点击前一模一样——用户完全感觉不到"我点了它，它有干活"，
  //   即便请求确实发到了后端。这里补上明确的、有停留时间的反馈：
  //     1. 正在检查时按钮禁用，避免连续点击并发出多个请求。
  //     2. 无论查到的结果是什么，都记录一条 recheckNote（还在等待 / 已处理
  //        完毕 / 查询失败），并附上时间戳；ResultCard 里常驻展示这条提示，
  //        而不是只有状态真的变化时才有动静。
  const recheckItem = async (i) => {
    const item = results[i]
    if (!item?.threadId || item.checking) return
    setResults(r => { const c=[...r]; c[i]={...c[i],checking:true,recheckNote:null}; return c })
    try {
      const state = await apiGetTaskPlanState(item.threadId, item.userId || 'default')
      setResults(r => {
        const c=[...r]
        if (state.is_awaiting_human) {
          c[i] = {
            ...c[i], checking:false, gateCount:(state.pending_gate_items||[]).length,
            recheckNote: { kind:'still-waiting', text:`仍在等待人工审核（${(state.pending_gate_items||[]).length} 项待处理） · ${new Date().toLocaleTimeString()}` },
          }
        } else {
          const doneCount = (state.task_plan||[]).filter(t=>t.status==='done').length
          const total = (state.task_plan||[]).length
          c[i] = {
            ...c[i], checking:false,
            status: state.plan_status === 'aborted' ? 'error' : 'done',
            answer: state.plan_status === 'aborted'
              ? '任务计划已在人工审核中被终止。'
              : `（人工审核已处理完毕，任务计划：${doneCount}/${total} 项完成）`,
            recheckNote: null,
          }
        }
        return c
      })
    } catch (e) {
      setResults(r => {
        const c=[...r]
        c[i]={...c[i],checking:false,recheckNote:{ kind:'error', text:`刷新失败：${e.message || '请求出错'} · ${new Date().toLocaleTimeString()}` }}
        return c
      })
    }
  }

  const stop = () => {
    abortRef.current.forEach(c => c?.abort())
    setRunning(false)
    // 把还没跑完的项目（running / pending）标记为"已暂停"
    // 这次 setResults 是同步排在 stop() 这次事件处理里的，
    // 一定先于 abort() 触发的异步 onError/onDone 回调生效，
    // 所以回调里只要检查当前状态是不是 paused 就能判断是否被主动打断，
    // 不需要额外用一个 ref/Set 去"提前打标签"。
    setResults(r => r.map(item =>
      (item.status === 'running' || item.status === 'pending')
        ? { ...item, status: 'paused' }
        : item
    ))
  }

  const run = async () => {
    const qs = cases.map(q=>q.trim()).filter(Boolean)
    if (!qs.length) return
    setRunning(true)
    abortRef.current = []

    // 判断是"续跑"还是"全新开始"：
    // 只要 results 数量和当前用例数一致，且已经有过进度（不是全部还是 pending），
    // 就视为续跑——保留 done 的结果，其余（pending/paused/error）都重新标记为 pending 待跑
    // ★ HITL 改动：'interrupted' 的用例也跟 'done' 一样原样保留，不重新标记为
    //   pending —— 它对应的会话在后端仍然真实冻结在 human_review_gate，
    //   重新发一遍会开一个全新的会话（因为 thread_id 传的是空字符串），
    //   原来那个真正在等人工处理的会话反而没人管了，变成孤儿会话。
    //   正确的处理方式是引导用户去「人工审核」面板处理，或者点「刷新状态」
    //   查询它是否已经被处理完，而不是在 Batch 页面里重跑它。
    const canResume = results.length === qs.length && results.some(r => r.status !== 'pending')
    const initResults = canResume
      ? results.map(r => (r.status === 'done' || r.status === 'interrupted') ? r : { question: r.question, status: 'pending', answer: '', ms: null })
      : qs.map(q => ({ question: q, status: 'pending', answer: '', ms: null }))

    setResults(initResults)

    const runOne = (q, i) => new Promise(resolve => {
      const t0 = Date.now()
      setResults(r => { const c=[...r]; c[i]={...c[i],status:'running',answer:''}; return c })

      const ctrl = apiChatStream({
        question: q, thread_id: '',
        onToken: (_, full) => {
          setResults(r => { const c=[...r]; c[i]={...c[i],answer:full}; return c })
        },
        onDone: (tid) => {
          setResults(r => {
            if (r[i].status === 'paused') return r // 已被暂停打断，不覆盖
            const c=[...r]; c[i]={...c[i],status:'done',ms:Date.now()-t0,threadId:tid||c[i].threadId}; return c
          })
          resolve()
        },
        onError: (err) => {
          setResults(r => {
            if (r[i].status === 'paused') return r // 已被暂停打断，不覆盖
            const c=[...r]; c[i]={...c[i],status:'error',answer:err,ms:Date.now()-t0}; return c
          })
          resolve()
        },
        // ★ HITL 改动：命中 human_review_gate 的 interrupt()，不是正常完成，
        //   也不是失败——是"冻结，等人工处理"。之前这里完全没有回调，导致
        //   这个 Promise 永远不 resolve，顺序模式下会把整条批量队列卡死，
        //   并行模式下会让对应的并发槽位永久占用。现在跟 ChatPanel 一样，
        //   记录 thread_id/user_id + 待办事项数量，转成 'interrupted' 状态，
        //   并且必须 resolve()，让批量任务能继续往下跑。
        onInterrupted: (payload, tid) => {
          const gateItems = payload.pending_gate_items || []
          setResults(r => {
            if (r[i].status === 'paused') return r // 已被暂停打断，不覆盖
            const c=[...r]
            c[i] = {
              ...c[i], status:'interrupted', ms:Date.now()-t0,
              threadId: tid, userId: 'default', gateCount: gateItems.length,
              message: `本次请求中有 ${gateItems.length} 个任务需要人工确认后才能继续（自动重试已耗尽，或涉及高风险操作）。`,
            }
            return c
          })
          resolve()
        },
        // ★ HITL 改动：409 rejected——这条用例对应的会话已经冻结在上一轮
        //   人工审核上，本轮请求被后端拒绝。在当前 Batch 实现里每条用例都用
        //   全新的空 thread_id 发起，正常情况下不会触发；这里仍然接上跟
        //   onInterrupted 一样的处理，避免万一（比如未来支持"续跑同一个
        //   thread_id"）出现同样的卡死问题。
        onRejected: (payload, tid) => {
          setResults(r => {
            if (r[i].status === 'paused') return r
            const c=[...r]
            c[i] = {
              ...c[i], status:'interrupted', ms:Date.now()-t0,
              threadId: tid || c[i].threadId, userId: 'default',
              gateCount: (payload.pending_gate_items||[]).length,
              message: payload.message || '当前会话存在未处理完的人工审核事项，请先处理完再发新消息。',
            }
            return c
          })
          resolve()
        },
      })
      abortRef.current[i] = ctrl
    })

    // 只跑还没完成的 index，done 的直接跳过；interrupted 的也跳过
    // （原因见上面 initResults 处的注释：它们对应真实存在、仍在等待
    // 人工处理的会话，不应该被重新发一遍）
    const pendingIndices = initResults
      .map((r, i) => ({ status: r.status, i }))
      .filter(x => x.status !== 'done' && x.status !== 'interrupted')
      .map(x => x.i)

    if (mode === 'seq') {
      for (const i of pendingIndices) await runOne(qs[i], i)
    } else {
      for (let k = 0; k < pendingIndices.length; k += concur) {
        const batch = pendingIndices.slice(k, k + concur)
        await Promise.all(batch.map(i => runOne(qs[i], i)))
      }
    }
    setRunning(false)
  }

  const done   = results.filter(r=>r.status==='done').length
  const failed = results.filter(r=>r.status==='error').length
  const awaitingReview = results.filter(r=>r.status==='interrupted').length
  const hasPaused = results.some(r => r.status === 'paused')

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

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
                  <Play size={13}/> {hasPaused ? '继续' : '运行全部'}
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
              {done}/{results.length} 完成
              {failed>0 && <span style={{color:'var(--err)'}}> · {failed} 失败</span>}
              {awaitingReview>0 && <span style={{color:'var(--warn)'}}> · {awaitingReview} 等待人工审核</span>}
            </span>
          </div>
        )}
      </div>

      {/* ★ Bugfix：右边这条滚动条"看得见、拉不动"——根因不在 flex/overflow 布局
          （那部分已经在前几轮修复过了），而是 app/globals.css 里全局写了
          `* { scrollbar-width: thin; scrollbar-color: ... }`。现代 Chrome
          （121+）只要检测到 scrollbar-width/scrollbar-color 被设成非 auto 的
          值，就会整个忽略 ::-webkit-scrollbar-* 这套旧样式（这是 Chrome 官方
          文档和 W3C CSSWG 都明确写过的行为）。也就是说 globals.css 里那段
          "让滚动条常驻可见、12px 宽、好抓"的 ::-webkit-scrollbar 规则，在
          真实 Chrome 里其实根本没生效——实际渲染的是原生的 scrollbar-width:
          thin 瘦滚动条。而"瘦滚动条"在 Chrome/Firefox 里有个长期存在的已知
          问题：可拖动的命中区域比视觉宽度窄得多，鼠标稍微偏一点就完全抓不住、
          拖不动，跟这里的症状完全对得上。这里不改全局 CSS（不影响其它面板），
          只在这一个滚动容器上把 scrollbarWidth/scrollbarColor 重置回 'auto'，
          让浏览器对这个元素重新按初始值处理，从而放行 ::-webkit-scrollbar
          那套更宽、真正可拖动的自定义样式生效。 */}
      <div style={{
        flex:1, minHeight:0, minWidth:0, overflowY:'scroll', overflowX:'hidden',
        padding:'16px 20px', display:'flex', flexDirection:'column', gap:10,
        scrollbarWidth:'auto', scrollbarColor:'auto',
      }}>
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
        {results.map((r, i) => (
          <ResultCard key={i} item={r} idx={i} onGoReview={goReview} onRecheck={recheckItem} />
        ))}
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
  interruptedBox: {
    display:'flex', flexDirection:'column', gap:8, padding:'12px 14px',
    borderTop:'1px solid rgba(251,191,36,.25)', background:'rgba(251,191,36,.08)',
    color:'var(--text)', fontSize:13, lineHeight:1.6,
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