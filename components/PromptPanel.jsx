'use client'
// components/PromptPanel.jsx
// Prompt 收藏夹：保存常用 prompt，一键插入到 Chat 面板
// 数据持久化到 Next.js SQLite（prisma/ui.db），重启不丢

import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Check, X, Copy, Tag, BookOpen } from 'lucide-react'
import { apiListPrompts, apiCreatePrompt, apiUpdatePrompt, apiDeletePrompt } from '../lib/client.js'

// 把 prompt 内容复制到剪贴板（最通用的"插入"方式）
function copyToClipboard(text) {
  return navigator.clipboard.writeText(text)
}

// ── 单条 Prompt 卡片 ────────────────────────────────
function PromptCard({ prompt, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [title,   setTitle]   = useState(prompt.title)
  const [content, setContent] = useState(prompt.content)
  const [tags,    setTags]    = useState(prompt.tags)
  const [copied,  setCopied]  = useState(false)
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      await onUpdate(prompt.id, { title: title.trim(), content: content.trim(), tags: tags.trim() })
      setEditing(false)
    } finally { 
      setSaving(false) 
    }
  }

  const cancel = () => {
    setTitle(prompt.title); setContent(prompt.content); setTags(prompt.tags)
    setEditing(false)
  }

  const copy = async () => {
    await copyToClipboard(prompt.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const tagList = prompt.tags ? prompt.tags.split(',').map(t => t.trim()).filter(Boolean) : []

  if (editing) {
    return (
      <div style={sC.card}>
        <input value={title} onChange={e=>setTitle(e.target.value)}
          placeholder="标题" style={sC.editInput} />
        <textarea value={content} onChange={e=>setContent(e.target.value)}
          placeholder="Prompt 内容" rows={4} style={sC.editTextarea} />
        <input value={tags} onChange={e=>setTags(e.target.value)}
          placeholder="标签（逗号分隔）" style={sC.editInput} />
        <div style={{ display:'flex', gap:8, marginTop:4 }}>
          <button onClick={save} disabled={saving||!title.trim()||!content.trim()} style={sC.saveBtn}>
            <Check size={12}/> 保存
          </button>
          <button onClick={cancel} style={sC.cancelBtn}><X size={12}/> 取消</button>
        </div>
      </div>
    )
  }

  return (
    <div style={sC.card} className="fade-in">
      <div style={sC.cardTop}>
        <span style={sC.cardTitle}>{prompt.title}</span>
        <div style={sC.actions}>
          <button onClick={copy} style={sC.iconBtn} title="复制到剪贴板">
            {copied ? <Check size={13} color="var(--ok)"/> : <Copy size={13}/>}
          </button>
          <button onClick={()=>setEditing(true)} style={sC.iconBtn} title="编辑">
            <Edit3 size={13}/>
          </button>
          <button onClick={()=>onDelete(prompt.id)} style={sC.iconBtn} title="删除">
            <Trash2 size={13}/>
          </button>
        </div>
      </div>

      <p style={sC.content}>{prompt.content}</p>

      {tagList.length > 0 && (
        <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginTop:6 }}>
          {tagList.map(t => (
            <span key={t} style={sC.tag}><Tag size={9}/> {t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────
export default function PromptPanel() {
  const [prompts,  setPrompts]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [adding,   setAdding]   = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody,  setNewBody]  = useState('')
  const [newTags,  setNewTags]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [search,   setSearch]   = useState('')
  const [log,      setLog]      = useState('')


  const load = async () => {
    setLoading(true)
   
    try {
      const res = await apiListPrompts()
      setPrompts(res.prompts ?? [])
    } catch (e) { setLog(`加载失败：${e.message}`) }
    finally { setLoading(false) }
  }

  

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!newTitle.trim() || !newBody.trim()) return
    setSaving(true)
    try {
      const res = await apiCreatePrompt({
        title:   newTitle.trim(),
        content: newBody.trim(),
        tags:    newTags.trim(),
      })
      setPrompts(p => [res.prompt, ...p])
      setNewTitle(''); setNewBody(''); setNewTags('')
      setAdding(false)
      setLog(`✓ 已保存：${res.prompt.title}`)
    } catch (e) { setLog(`保存失败：${e.message}`) }
    finally { setSaving(false) }
  }

  const update = async (id, data) => {
    const res = await apiUpdatePrompt(id, data)
    setPrompts(p => p.map(x => x.id === id ? res.prompt : x))
    setLog(`✓ 已更新：${res.prompt.title}`)
  }

  const del = async (id) => {
    await apiDeletePrompt(id)
    setPrompts(p => p.filter(x => x.id !== id))
    setLog('✓ 已删除')
  }

  // 前端搜索过滤
  const filtered = prompts.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.title.toLowerCase().includes(q) ||
           p.content.toLowerCase().includes(q) ||
           p.tags.toLowerCase().includes(q)
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }} className="fade-up">

      {/* 顶部：统计 + 搜索 + 新增按钮 */}
      <div style={s.topBar}>
        <div style={s.countBadge}>
          <BookOpen size={14} color="var(--accent3)"/>
          <span style={{ fontFamily:'var(--mono)', color:'var(--accent3)', fontWeight:700 }}>{prompts.length}</span>
          <span style={{ fontSize:12, color:'var(--sub)' }}>个收藏 Prompt</span>
        </div>
        <input
          value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="搜索…" style={s.searchInput}
        />
        <button onClick={()=>setAdding(v=>!v)} style={s.addBtn}>
          <Plus size={14}/> 新增
        </button>
      </div>

      {/* 提示 */}
      {log && (
        <div style={{ fontFamily:'var(--mono)', fontSize:12,
          color: log.startsWith('✓') ? 'var(--ok)' : 'var(--err)',
          padding:'0 4px' }}>
          {log}
        </div>
      )}

      {/* 新增表单 */}
      {adding && (
        <div style={s.addForm} className="fade-up">
          <div style={s.cardTitle}>新增 Prompt</div>
          <input value={newTitle} onChange={e=>setNewTitle(e.target.value)}
            placeholder="标题（如：介绍量子计算）" style={s.input} />
          <textarea value={newBody} onChange={e=>setNewBody(e.target.value)}
            placeholder="Prompt 内容…" rows={4} style={{ ...s.input, resize:'vertical', lineHeight:1.6 }} />
          <input value={newTags} onChange={e=>setNewTags(e.target.value)}
            placeholder="标签（逗号分隔，如：科学, 教学）" style={s.input} />
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={create} disabled={saving||!newTitle.trim()||!newBody.trim()} style={s.saveBtn}>
              {saving ? '保存中…' : <><Check size={13}/> 保存</>}
            </button>
            <button onClick={()=>{setAdding(false);setNewTitle('');setNewBody('');setNewTags('')}}
              style={s.cancelBtn}><X size={13}/> 取消</button>
          </div>
        </div>
      )}

      {/* Prompt 列表 */}
      {loading ? (
        <div style={s.hint}>加载中…</div>
      ) : filtered.length === 0 ? (
        <div style={s.hint}>
          {prompts.length !== 0
            ? '还没有收藏的 Prompt，点击「新增」开始添加。'
            : '没有匹配的结果'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(p => (
            <PromptCard key={p.id} prompt={p} onDelete={del} onUpdate={update} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 样式 ──────────────────────────────────────────────
const s = {
  topBar: { display:'flex', alignItems:'center', gap:10 },
  countBadge: {
    display:'flex', alignItems:'center', gap:6,
    padding:'6px 12px', background:'rgba(167,139,250,.08)',
    border:'1px solid rgba(167,139,250,.2)', borderRadius:99, flexShrink:0,
  },
  searchInput: {
    flex:1, padding:'7px 12px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5, outline:'none',
  },
  addBtn: {
    display:'flex', alignItems:'center', gap:6, padding:'7px 16px',
    background:'var(--accent3)', border:'none', borderRadius:8,
    color:'#fff', cursor:'pointer', fontFamily:'var(--sans)', fontSize:13,
    fontWeight:500, flexShrink:0,
  },
  addForm: {
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:'var(--r-lg)', padding:'18px 20px',
    display:'flex', flexDirection:'column', gap:10,
  },
  cardTitle: {
    fontFamily:'var(--mono)', fontSize:12, fontWeight:600,
    color:'var(--sub)', letterSpacing:'.06em', textTransform:'uppercase',
  },
  input: {
    padding:'8px 12px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:8,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5, outline:'none', width:'100%',
  },
  saveBtn: {
    display:'inline-flex', alignItems:'center', gap:6, padding:'7px 16px',
    background:'var(--accent)', border:'none', borderRadius:8,
    color:'#fff', cursor:'pointer', fontSize:13, fontFamily:'var(--sans)', fontWeight:500,
  },
  cancelBtn: {
    display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px',
    background:'var(--s2)', border:'1px solid var(--border)', borderRadius:8,
    color:'var(--sub)', cursor:'pointer', fontSize:13, fontFamily:'var(--sans)',
  },
  hint: {
    color:'var(--sub)', fontFamily:'var(--mono)', fontSize:13,
    padding:'20px 4px', lineHeight:1.8,
  },
}

const sC = {
  card: {
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:'var(--r-lg)', padding:'14px 16px',
    display:'flex', flexDirection:'column', gap:6,
  },
  cardTop: { display:'flex', alignItems:'flex-start', gap:8 },
  cardTitle: {
    flex:1, fontFamily:'var(--mono)', fontSize:13, fontWeight:600,
    color:'var(--text)', lineHeight:1.4,
  },
  content: {
    fontSize:12.5, color:'var(--sub)', lineHeight:1.65,
    whiteSpace:'pre-wrap', wordBreak:'break-word',
    maxHeight:80, overflow:'hidden',
    display:'-webkit-box', WebkitLineClamp:4, WebkitBoxOrient:'vertical',
  },
  tag: {
    display:'inline-flex', alignItems:'center', gap:3,
    padding:'2px 8px', borderRadius:99,
    background:'rgba(91,156,246,.08)', border:'1px solid rgba(91,156,246,.15)',
    color:'var(--accent)', fontSize:10.5, fontFamily:'var(--mono)',
  },
  actions: { display:'flex', gap:2, flexShrink:0 },
  iconBtn: {
    padding:5, background:'none', border:'none',
    color:'var(--sub)', cursor:'pointer', display:'flex',
    borderRadius:6, transition:'color .15s',
  },
  editInput: {
    padding:'7px 10px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5, outline:'none', width:'100%',
  },
  editTextarea: {
    padding:'7px 10px', background:'var(--s2)',
    border:'1px solid var(--border)', borderRadius:7,
    color:'var(--text)', fontFamily:'var(--mono)', fontSize:12.5, outline:'none',
    width:'100%', resize:'vertical', lineHeight:1.6,
  },
  saveBtn: {
    display:'inline-flex', alignItems:'center', gap:5, padding:'6px 14px',
    background:'var(--accent)', border:'none', borderRadius:7,
    color:'#fff', cursor:'pointer', fontSize:12.5, fontFamily:'var(--sans)',
  },
  cancelBtn: {
    display:'inline-flex', alignItems:'center', gap:5, padding:'6px 12px',
    background:'none', border:'1px solid var(--border)', borderRadius:7,
    color:'var(--sub)', cursor:'pointer', fontSize:12.5, fontFamily:'var(--sans)',
  },
}
