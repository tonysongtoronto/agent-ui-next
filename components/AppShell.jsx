'use client'
// components/AppShell.jsx  ——  第四阶段更新
// 新增：TracePanel（LangSmith）、PromptPanel（收藏夹）

import { useState } from 'react'
import { Activity, MessageSquare, Layers, GitBranch, Database,
         Settings, Zap, GitCommit, BookMarked, Wrench } from 'lucide-react'
import { useHealth } from '../hooks/useHealth.js'
import { getBaseUrl, setBaseUrl } from '../lib/client.js'

import HealthPanel     from './HealthPanel.jsx'
import AgentToolsPanel from './AgentToolsPanel.jsx'
import ChatPanel       from './ChatPanel.jsx'
import BatchPanel      from './BatchPanel.jsx'
import MultiTurnPanel  from './MultiTurnPanel.jsx'
import SessionPanel    from './SessionPanel.jsx'
import MemoryPanel     from './MemoryPanel.jsx'
import TracePanel      from './TracePanel.jsx'
import PromptPanel     from './PromptPanel.jsx'

const NAV = [
  { id:'health',    label:'Health',      icon: Activity,     section:'监控' },
  { id:'tools',     label:'Agent Tools', icon: Wrench,       section:'监控' },
  { id:'traces',    label:'Traces',      icon: GitCommit,    section:'监控' },
  { id:'chat',      label:'Chat',        icon: MessageSquare,section:'对话' },
  { id:'batch',     label:'Batch Test',  icon: Layers,       section:'对话' },
  { id:'multiturn', label:'Multi-Turn',  icon: GitBranch,    section:'对话' },
  { id:'prompts',   label:'Prompts',     icon: BookMarked,   section:'对话' },
  { id:'session',   label:'Sessions',    icon: Settings,     section:'管理' },
  { id:'memory',    label:'Memory',      icon: Database,     section:'管理' },
]

const STATUS_DOT = {
  ok:           { color:'var(--ok)',      shadow:'var(--ok)',     pulse:false },
  degraded:     { color:'var(--warn)',    shadow:'var(--warn)',   pulse:true  },
  initializing: { color:'var(--accent)', shadow:'var(--accent)', pulse:true  },
  error:        { color:'var(--err)',     shadow:'var(--err)',    pulse:false },
  idle:         { color:'var(--border2)',shadow:'transparent',   pulse:false },
}

export default function AppShell() {
  const [active,  setActive]  = useState('health')
  const [baseUrl, setBase]    = useState(getBaseUrl)
  const { status, data }      = useHealth(15000)

  const handleBaseUrl = (e) => {
    if (e.key === 'Enter' || e.type === 'blur') setBaseUrl(baseUrl)
  }

  const dot      = STATUS_DOT[status] || STATUS_DOT.idle
  const sections = [...new Set(NAV.map(n => n.section))]

  const panels = {
    health:    <HealthPanel />,
    tools:     <AgentToolsPanel />,
    traces:    <TracePanel />,
    chat:      <ChatPanel />,
    batch:     <BatchPanel />,
    multiturn: <MultiTurnPanel />,
    prompts:   <PromptPanel />,
    session:   <SessionPanel />,
    memory:    <MemoryPanel />,
  }

  const panelMeta = {
    health:    { title:'Health Check',    desc:'服务状态 · MCP 工具 · 运行时信息' },
    tools:     { title:'Agent Tools',     desc:'已注册 Agent · 各自挂载的 MCP 工具一览' },
    traces:    { title:'Traces',          desc:'LangSmith 运行记录 · Token 用量 · 执行链路' },
    chat:      { title:'Chat',            desc:'单次对话 · 流式输出 · 多轮记忆' },
    batch:     { title:'Batch Test',      desc:'批量测试 · 顺序 / 并行执行' },
    multiturn: { title:'Multi-Turn',      desc:'多轮对话时间线 · 跨轮记忆验证' },
    prompts:   { title:'Prompt Library',  desc:'常用 Prompt 收藏夹 · 持久化 · 一键复制' },
    session:   { title:'Sessions',        desc:'会话管理 · 别名 / Pin · 持久化元数据' },
    memory:    { title:'Memory Store',    desc:'全局记忆 · AsyncSqliteStore · system 命名空间' },
  }

  const pt = panelMeta[active]

  return (
    <div style={styles.root}>
      {/* ── Top Bar ─────────────────────────── */}
      <header style={styles.topbar}>
        <div style={styles.logo}>
          <Zap size={18} color="var(--accent)" strokeWidth={2.5}/>
          <span style={styles.logoText}>
            Agent<span style={{ color:'var(--sub)', fontWeight:400 }}>UI</span>
          </span>
          <span style={styles.version}>v4.0-next</span>
        </div>
        <div style={styles.sep}/>
        <input
          value={baseUrl}
          onChange={e => setBase(e.target.value)}
          onKeyDown={handleBaseUrl}
          onBlur={handleBaseUrl}
          placeholder="http://localhost:8000"
          style={styles.urlInput}
          title="Python 后端地址（按 Enter 生效）"
        />
        <div style={styles.statusArea}>
          <div style={{
            ...styles.dot,
            background: dot.color,
            boxShadow: `0 0 8px ${dot.shadow}`,
            animation: dot.pulse ? 'pulse 1.2s ease infinite' : 'none',
          }}/>
          <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)' }}>
            {status==='ok'           && `正常 · ${data?.tool_count ?? 0} tools`}
            {status==='degraded'     && `降级 · ${data?.tool_count ?? 0} tools`}
            {status==='initializing' && '初始化中…'}
            {status==='error'        && '连接失败'}
            {status==='idle'         && '检测中…'}
          </span>
        </div>
      </header>

      {/* ── Sidebar ─────────────────────────── */}
      <nav style={styles.sidebar}>
        {sections.map(sec => (
          <div key={sec}>
            <div style={styles.navSection}>{sec}</div>
            {NAV.filter(n => n.section === sec).map(item => {
              const Icon = item.icon
              const isActive = active === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  style={{
                    ...styles.navItem,
                    color:           isActive ? 'var(--accent)'         : 'var(--sub)',
                    background:      isActive ? 'rgba(91,156,246,.08)'  : 'transparent',
                    borderLeftColor: isActive ? 'var(--accent)'         : 'transparent',
                  }}
                >
                  <Icon size={15} style={{ flexShrink:0 }}/>
                  {item.label}
                  {item.id === 'health' && status === 'error' && (
                    <span style={styles.errDot}/>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Main ────────────────────────────── */}
      <main style={styles.main}>
        <div style={styles.panelHeader}>
          <div>
            <div style={styles.panelTitle}>{pt.title}</div>
            <div style={styles.panelDesc}>{pt.desc}</div>
          </div>
        </div>
        <div style={styles.panelBody}>
          {panels[active]}
        </div>
      </main>
    </div>
  )
}

const styles = {
  root: { height:'100vh', display:'grid', gridTemplateRows:'52px 1fr', gridTemplateColumns:'210px 1fr', gridTemplateAreas:'"topbar topbar" "sidebar main"', overflow:'hidden' },
  topbar: { gridArea:'topbar', background:'var(--s1)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 20px', gap:14, flexShrink:0 },
  logo: { display:'flex', alignItems:'center', gap:8, marginRight:4, flexShrink:0 },
  logoText: { fontFamily:'var(--mono)', fontSize:14, fontWeight:700, color:'var(--text)' },
  version: { background:'rgba(91,156,246,.12)', border:'1px solid rgba(91,156,246,.2)', color:'var(--accent)', borderRadius:99, padding:'1px 8px', fontSize:10, fontFamily:'var(--mono)', fontWeight:600 },
  sep: { width:1, height:22, background:'var(--border)', flexShrink:0 },
  urlInput: { fontFamily:'var(--mono)', fontSize:12, background:'var(--s2)', border:'1px solid var(--border)', color:'var(--sub)', padding:'5px 10px', borderRadius:7, width:260, outline:'none' },
  statusArea: { marginLeft:'auto', display:'flex', alignItems:'center', gap:7, flexShrink:0 },
  dot: { width:7, height:7, borderRadius:'50%', transition:'background .3s' },
  sidebar: { gridArea:'sidebar', background:'var(--s1)', borderRight:'1px solid var(--border)', padding:'14px 0', display:'flex', flexDirection:'column', gap:2, overflowY:'auto' },
  navSection: { fontFamily:'var(--mono)', fontSize:10, fontWeight:600, color:'var(--sub)', letterSpacing:'.1em', textTransform:'uppercase', padding:'10px 18px 4px' },
  navItem: { display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 18px', fontSize:13, fontWeight:500, border:'none', borderLeft:'3px solid transparent', cursor:'pointer', transition:'all .15s', textAlign:'left', fontFamily:'var(--sans)', background:'transparent', position:'relative' },
  errDot: { marginLeft:'auto', width:6, height:6, borderRadius:'50%', background:'var(--err)', boxShadow:'0 0 6px var(--err)' },
  main: { gridArea:'main', display:'flex', flexDirection:'column', overflow:'hidden' },
  panelHeader: { padding:'14px 24px', borderBottom:'1px solid var(--border)', flexShrink:0 },
  panelTitle: { fontFamily:'var(--mono)', fontSize:15, fontWeight:700, color:'var(--text)' },
  panelDesc: { fontSize:12, color:'var(--sub)', marginTop:2 },
  panelBody: { flex:1, overflow:'hidden', display:'flex', flexDirection:'column' },
}
