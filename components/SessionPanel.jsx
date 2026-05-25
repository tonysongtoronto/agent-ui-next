'use client'
// components/SessionPanel.jsx  ——  增强版（第四阶段）
// 新增：会话别名、Pin置顶、备注、持久化到 Next.js SQLite

import { useState, useEffect } from 'react'
import { Plus, Trash2, Copy, Check, Pin, PinOff, Edit3, X, Save, RefreshCw } from 'lucide-react'
import {
  apiNewSession, apiClearSession,
  apiListUiSessions, apiSaveUiSession,
  apiUpdateUiSession, apiDeleteUiSession,
} from '../lib/client.js'

function SessionRow({ s, onPin, onDelete, onUpdate, onCopy, copied }) {
  const [editing, setEditing] = useState(false)
  const [label,   setLabel]   = useState(s.label)
  const [note,    setNote]    = useState(s.note)

  const saveEdit = async () => {
    await onUpdate(s.thread_id, { label: label.trim(), note: note.trim() })
    setEditing(false)
  }

  return (
    <div style={{
      ...sR.row,
      borderLeft: s.pinned ? '3px solid var(--accent)' : '3px solid transparent',
      background:  s.pinned ? 'rgba(91,156,246,.04)' : 'var(--s2)',
    }} className="fade-in">
      <div style={sR.info}>
        {editing ? (
          <div style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
            <input value={label} onChange={e=>setLabel(e.target.value)}
              placeholder="会话别名（如：周报讨论）" style={sR.editInput} />
            <input value={note} onChange={e=>setNote(e.target.value)}
              placeholder="备注（可选）" style={sR.editInput} />
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={saveEdit} style={sR.saveBtn}><Save size={11}/> 保存</button>
              <button onClick={()=>{setLabel(s.label);setNote(s.note);setEditing(false)}}
                style={sR.cancelBtn}><X size={11}/> 取消</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {s.label
                ? <span style={sR.label}>{s.label}</span>
                : <span style={sR.labelEmpty}>未命名</span>}
              {s.pinned && <span style={sR.pinBadge}>📌</span>}
            </div>
            <code style={sR.tid}>{s.thread_id}</code>
            {s.note && <span style={sR.note}>{s.note}</span>}
            <span style={sR.time}>{new Date(s.created_at).toLocaleString()}</span>
          </>
        )}
      </div>
      {!editing && (
         <div style={sR.actions}>
  
          <button onClick={()=>onCopy(s.thread_id)} style={sR.iconBtn} title="复制">
            {copied===s.thread_id ? <Check size={13} color="var(--ok)"/> : <Copy size={13}/>}
          </button>
          <button onClick={()=>setEditing(true)} style={sR.iconBtn} title="编辑"><Edit3 size={13}/></button>
          <button onClick={()=>onPin(s.thread_id, !s.pinned)} style={sR.iconBtn} title={s.pinned?'取消置顶':'置顶'}>
            {s.pinned ? <PinOff size={13} color="var(--accent)"/> : <Pin size={13}/>}
          </button>
          <button onClick={()=>onDelete(s.thread_id)} style={sR.dangerBtn} title="清除">
            <Trash2 size={13}/>
          </button>
        </div>
      )}
    </div>
  )
}

export default function SessionPanel() {
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [manualId, setManualId] = useState('')
  const [copied,   setCopied]   = useState(null)
  const [log,      setLog]      = useState([])

  const addLog = (type, msg) =>
    setLog(l => [{ type, msg, ts: new Date().toLocaleTimeString() }, ...l].slice(0, 30))

  const loadSessions = async () => {
    try {
      const res = await apiListUiSessions()
      setSessions(res.sessions ?? [])
    } catch (e) { addLog('warn', `⚠ 加载失败：${e.message}`) }
  }

  useEffect(() => { loadSessions() }, [])

  const createSession = async () => {
    setLoading(true)
    try {
      const res = await apiNewSession()
      await apiSaveUiSession(res.thread_id, { label:'', pinned:false, note:'' })
      addLog('ok', `✓ 创建：${res.thread_id}`)
      await loadSessions()
    } catch (e) { addLog('err', `✗ 创建失败：${e.message}`) }
    finally { setLoading(false) }
  }

  const clearSession = async (thread_id) => {
    if (!window.confirm(`确定清除 ${thread_id} 的历史？不可恢复。`)) return
    setLoading(true)
    try {
      await apiClearSession(thread_id)
      await apiDeleteUiSession(thread_id)
      addLog('ok', `✓ 已清除：${thread_id}`)
      await loadSessions()
    } catch (e) { addLog('err', `✗ 清除失败：${e.message}`) }
    finally { setLoading(false) }
  }

  const clearManual = async () => {
    if (!manualId.trim()) return
    await clearSession(manualId.trim())
    setManualId('')
  }

  const updateSession = async (thread_id, data) => {
    try {
      await apiUpdateUiSession(thread_id, data)
      addLog('ok', `✓ 已更新`)
      await loadSessions()
    } catch (e) { addLog('err', `✗ 更新失败：${e.message}`) }
  }

  const copyTid = (tid) => {
    navigator.clipboard.writeText(tid).then(() => {
      setCopied(tid); setTimeout(() => setCopied(null), 1500)
    })
  }

  const pinned   = sessions.filter(s => s.pinned)
  const unpinned = sessions.filter(s => !s.pinned)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }} className="fade-up">
      {/* 新建 */}
      <div style={sty.card}>
        <div style={sty.cardTitle}>新建会话</div>
        <p style={sty.desc}>生成新 thread_id，自动保存到列表，可设置别名、置顶、备注。</p>
        <button onClick={createSession} disabled={loading} style={sty.primaryBtn}>
          {loading ? <span style={sty.spinner}/> : <Plus size={14}/>} 新建会话
        </button>
      </div>

      {/* 手动清除 */}
      <div style={sty.card}>
        <div style={sty.cardTitle}>手动清除</div>
        <p style={sty.desc}>清除指定会话的 LangGraph checkpoint（不可恢复）。</p>
        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <input value={manualId} onChange={e=>setManualId(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&clearManual()}
            placeholder="输入 thread_id…" style={sty.input} />
          <button onClick={clearManual} disabled={!manualId.trim()||loading} style={sty.dangerBtn}>
            <Trash2 size={14}/> 清除
          </button>
        </div>
      </div>

      {/* 会话列表 */}
      {sessions.length > 0 && (
        <div style={sty.card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={sty.cardTitle}>已保存会话 · {sessions.length} 个</div>
            <button onClick={loadSessions} style={sty.refreshBtn}>
              <RefreshCw size={12}/> 刷新
            </button>
          </div>

          <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
            {pinned.length > 0 && (
              <div style={{ marginBottom:10 }}>
                <div style={sty.groupLabel}>📌 置顶</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {pinned.map(s => <SessionRow key={s.thread_id} s={s}
                    onPin={(tid, p) => updateSession(tid, { pinned: p })}
                    onDelete={clearSession} onUpdate={updateSession}
                    onCopy={copyTid} copied={copied}/>)}
                </div>
              </div>
            )}
            {unpinned.length > 0 && (
              <div>
                {pinned.length > 0 && <div style={sty.groupLabel}>其他</div>}
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {unpinned.map(s => <SessionRow key={s.thread_id} s={s}
                    onPin={(tid, p) => updateSession(tid, { pinned: p })}
                    onDelete={clearSession} onUpdate={updateSession}
                    onCopy={copyTid} copied={copied}/>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 日志 */}
      {log.length > 0 && (
        <div style={sty.card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={sty.cardTitle}>操作日志</div>
            <button onClick={()=>setLog([])} style={sty.iconBtn}><Trash2 size={12}/></button>
          </div>
          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:4 }}>
            {log.map((l, i) => (
              <div key={i} style={{ fontFamily:'var(--mono)', fontSize:11.5, display:'flex', gap:8,
                color: l.type==='ok'?'var(--ok)':l.type==='err'?'var(--err)':'var(--warn)' }}>
                <span style={{ color:'var(--sub)', flexShrink:0 }}>{l.ts}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const sty = {
  card: { background:'var(--s1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'18px 20px' },
  cardTitle: { fontFamily:'var(--mono)', fontSize:12, fontWeight:600, color:'var(--sub)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:6 },
  desc: { fontSize:12.5, color:'var(--sub)', lineHeight:1.6 },
  groupLabel: { fontFamily:'var(--mono)', fontSize:10, color:'var(--sub)', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:6 },
  input: { flex:1, padding:'8px 12px', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5, outline:'none' },
  primaryBtn: { marginTop:12, display:'inline-flex', alignItems:'center', gap:6, padding:'8px 18px', background:'var(--accent)', border:'none', borderRadius:8, color:'#fff', cursor:'pointer', fontFamily:'var(--sans)', fontSize:13, fontWeight:500 },
  dangerBtn: { display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'rgba(248,113,113,.12)', border:'1px solid rgba(248,113,113,.25)', borderRadius:8, color:'var(--err)', cursor:'pointer', fontFamily:'var(--sans)', fontSize:13, whiteSpace:'nowrap' },
  refreshBtn: { display:'flex', alignItems:'center', gap:5, padding:'4px 10px', background:'var(--s2)', border:'1px solid var(--border)', borderRadius:7, color:'var(--sub)', cursor:'pointer', fontSize:12, fontFamily:'var(--sans)' },
  iconBtn: { padding:5, background:'none', border:'none', color:'var(--sub)', cursor:'pointer', display:'flex', borderRadius:6 },
  spinner: { display:'inline-block', width:12, height:12, border:'2px solid rgba(255,255,255,.2)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin .6s linear infinite' },
}

const sR = {
  row: { borderRadius:8, padding:'10px 14px', border:'1px solid var(--border)', display:'flex', alignItems:'flex-start', gap:10 },
  info: { flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:3 },
  label: { fontFamily:'var(--mono)', fontSize:13, fontWeight:600, color:'var(--text)' },
  labelEmpty: { fontFamily:'var(--mono)', fontSize:12, color:'var(--border2)', fontStyle:'italic' },
  pinBadge: { fontSize:12 },
  tid: { fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)' },
  note: { fontSize:12, color:'var(--sub)', fontStyle:'italic' },
  time: { fontFamily:'var(--mono)', fontSize:10, color:'var(--border2)' },
  actions: { display:'flex', gap:2, flexShrink:0, alignItems:'center' },
  iconBtn: { padding:5, background:'none', border:'none', color:'var(--sub)', cursor:'pointer', display:'flex', borderRadius:6 },
  dangerBtn: { padding:5, background:'none', border:'none', color:'var(--sub)', cursor:'pointer', display:'flex', borderRadius:6 },
  editInput: { padding:'6px 10px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:7, color:'var(--text)', fontFamily:'var(--mono)', fontSize:12, outline:'none', width:'100%' },
  saveBtn: { display:'inline-flex', alignItems:'center', gap:4, padding:'5px 12px', background:'var(--accent)', border:'none', borderRadius:7, color:'#fff', cursor:'pointer', fontSize:12 },
  cancelBtn: { display:'inline-flex', alignItems:'center', gap:4, padding:'5px 10px', background:'none', border:'1px solid var(--border)', borderRadius:7, color:'var(--sub)', cursor:'pointer', fontSize:12 },
}