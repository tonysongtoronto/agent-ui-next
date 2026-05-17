'use client'
// components/MemoryPanel.jsx — Next.js 版本
// 变化：顶部加了 'use client'，import 路径改为 '../lib/client'
import { useState, useEffect } from 'react'
import { RefreshCw, Plus, Trash2, Database } from 'lucide-react'
import { apiListMemory, apiPutMemory, apiDeleteMemory } from '../lib/client.js'

export default function MemoryPanel() {
  const [items,   setItems]   = useState({})
  const [loading, setLoading] = useState(false)
  const [newKey,  setNewKey]  = useState('')
  const [newVal,  setNewVal]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [log,     setLog]     = useState([])

  const addLog = (type, msg) =>
    setLog(l => [{ type, msg, ts: new Date().toLocaleTimeString() }, ...l].slice(0, 20))

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiListMemory()
      setItems(res.items || {})
    } catch (e) {
      addLog('err', `✗ 加载失败：${e.message}`)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    if (!newKey.trim() || !newVal.trim()) return
    setSaving(true)
    try {
      await apiPutMemory(newKey.trim(), newVal.trim())
      addLog('ok', `✓ 已写入：${newKey} = ${newVal.slice(0,40)}`)
      setNewKey(''); setNewVal('')
      await load()
    } catch (e) {
      addLog('err', `✗ 写入失败：${e.message}`)
    } finally { setSaving(false) }
  }

  const del = async (key) => {
    try {
      await apiDeleteMemory(key)
      addLog('ok', `✓ 已删除：${key}`)
      await load()
    } catch (e) {
      addLog('err', `✗ 删除失败：${e.message}`)
    }
  }

  const count = Object.keys(items).length

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }} className="fade-up">

      {/* Header stat */}
      <div style={styles.statCard}>
        <Database size={18} color="var(--accent2)" />
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:22, fontWeight:700, color:'var(--accent2)' }}>
            {count}
          </div>
          <div style={{ fontSize:12, color:'var(--sub)' }}>条全局记忆（SQLite 持久化）</div>
        </div>
        <button onClick={load} disabled={loading} style={styles.refreshBtn}>
          <RefreshCw size={14} style={{ animation:loading?'spin .6s linear infinite':'none' }}/>
          刷新
        </button>
      </div>

      {/* Write new */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>写入新记忆</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
          <div style={{ display:'flex', gap:8 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:4, flex:'0 0 200px' }}>
              <span style={styles.label}>Key</span>
              <input value={newKey} onChange={e=>setNewKey(e.target.value)}
                placeholder="记忆键名" style={styles.input}/>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4, flex:1 }}>
              <span style={styles.label}>Value</span>
              <input value={newVal} onChange={e=>setNewVal(e.target.value)}
                placeholder="记忆内容" style={styles.input}
                onKeyDown={e=>e.key==='Enter'&&save()}/>
            </div>
          </div>
          <button onClick={save} disabled={saving||!newKey.trim()||!newVal.trim()} style={styles.saveBtn}>
            {saving ? <span style={styles.spinner}/> : <Plus size={14}/>}
            写入记忆
          </button>
        </div>
      </div>

      {/* Memory list */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>当前全局记忆 · system 命名空间</div>
        {count === 0
          ? <div style={{ marginTop:14, color:'var(--sub)', fontSize:13, fontFamily:'var(--mono)' }}>
              暂无记忆
            </div>
          : (
            <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
              {Object.entries(items).map(([k, v]) => {
                const display = typeof v === 'object' ? (v.value ?? JSON.stringify(v)) : v
                return (
                  <div key={k} style={styles.memRow} className="fade-in">
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={styles.memKey}>{k}</div>
                      <div style={styles.memVal}>{String(display)}</div>
                    </div>
                    <button onClick={()=>del(k)} style={styles.delBtn} title="删除">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                )
              })}
            </div>
          )
        }
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={styles.card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={styles.cardTitle}>操作日志</div>
            <button onClick={()=>setLog([])} style={styles.delBtn}><Trash2 size={12}/></button>
          </div>
          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:3 }}>
            {log.map((l, i) => (
              <div key={i} style={{ fontFamily:'var(--mono)', fontSize:11.5, display:'flex', gap:8,
                color: l.type==='ok'?'var(--ok)':'var(--err)' }}>
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

const styles = {
  statCard: {
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:'var(--r-lg)', padding:'18px 20px',
    display:'flex', alignItems:'center', gap:14,
  },
  card: {
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:'var(--r-lg)', padding:'18px 20px',
  },
  cardTitle: {
    fontFamily:'var(--mono)', fontSize:12, fontWeight:600,
    color:'var(--sub)', letterSpacing:'.06em', textTransform:'uppercase',
  },
  label: {
    fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)',
    letterSpacing:'.04em', textTransform:'uppercase',
  },
  input: {
    padding:'8px 12px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5,
    outline:'none', width:'100%',
  },
  saveBtn: {
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'8px 18px', background:'var(--accent2)',
    border:'none', borderRadius:8, color:'#0a1a14', cursor:'pointer',
    fontFamily:'var(--sans)', fontSize:13, fontWeight:600,
    alignSelf:'flex-start',
  },
  refreshBtn: {
    marginLeft:'auto', display:'flex', alignItems:'center', gap:6,
    padding:'7px 14px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--sub)', cursor:'pointer', fontFamily:'var(--sans)', fontSize:12,
  },
  memRow: {
    display:'flex', alignItems:'flex-start', gap:10,
    padding:'10px 14px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
  },
  memKey: {
    fontFamily:'var(--mono)', fontSize:12, fontWeight:600,
    color:'var(--accent)', marginBottom:3,
  },
  memVal: { fontSize:13, color:'var(--text)', lineHeight:1.5, wordBreak:'break-all' },
  delBtn: {
    padding:6, background:'none', border:'none',
    color:'var(--sub)', cursor:'pointer', display:'flex',
    borderRadius:6, flexShrink:0,
  },
  spinner: {
    display:'inline-block', width:12, height:12,
    border:'2px solid rgba(0,0,0,.2)', borderTopColor:'#0a1a14',
    borderRadius:'50%', animation:'spin .6s linear infinite',
  },
}
