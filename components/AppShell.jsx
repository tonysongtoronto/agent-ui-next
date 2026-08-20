'use client'
// components/AppShell.jsx  ——  第四阶段更新
// 新增：TracePanel（LangSmith）、PromptPanel（收藏夹）

import { useState, useEffect } from 'react'
import { Activity, MessageSquare, Layers, GitBranch, Database,
         Settings, Zap, GitCommit, BookMarked, Wrench, ClipboardCheck } from 'lucide-react'
import { useHealth } from '../hooks/useHealth.js'
import { useAwaitingHuman } from '../hooks/useAwaitingHuman.js'
import { getBaseUrl, setBaseUrl } from '../lib/client.js'
import { onNavigate } from '../lib/shared.js'

import HealthPanel     from './HealthPanel.jsx'
import AgentToolsPanel from './AgentToolsPanel.jsx'
import ChatPanel       from './ChatPanel.jsx'
import BatchPanel      from './BatchPanel.jsx'
import MultiTurnPanel  from './MultiTurnPanel.jsx'
import SessionPanel    from './SessionPanel.jsx'
import MemoryPanel     from './MemoryPanel.jsx'
import TracePanel      from './TracePanel.jsx'
import PromptPanel     from './PromptPanel.jsx'
import TaskReviewPanel from './TaskReviewPanel.jsx'

const NAV = [
  { id:'health',    label:'Health',      icon: Activity,     section:'监控' },
  { id:'tools',     label:'Agent Tools', icon: Wrench,       section:'监控' },
  { id:'traces',    label:'Traces',      icon: GitCommit,    section:'监控' },
  { id:'chat',      label:'Chat',        icon: MessageSquare,section:'对话' },
  { id:'batch',     label:'Batch Test',  icon: Layers,       section:'对话' },
  { id:'multiturn', label:'Multi-Turn',  icon: GitBranch,    section:'对话' },
  { id:'prompts',   label:'Prompts',     icon: BookMarked,   section:'对话' },
  { id:'review',    label:'人工审核',     icon: ClipboardCheck, section:'对话' },
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
  // ★ HITL 改动：轮询当前共享会话是否冻结在人工审核，侧边栏显示红点提醒
  const { isAwaiting, gateCount } = useAwaitingHuman(8000)

  // ★ Bugfix：之前 `{panels[active]}` 只渲染当前激活的那一个面板，切走
  //   的瞬间旧面板就被 React 整个卸载——所有内部 useState（Batch Test 的
  //   运行结果、暂停状态、Chat 的消息列表等）全部清空。比如在 Batch Test
  //   点「前往人工审核」跳到 review 面板处理完，再切回来 Batch Test 已经
  //   变回了空白的初始录入界面，之前跑完的/暂停的结果全丢了。
  //   这里改成"访问过的面板保持挂载，只是用 CSS display 切换显隐"（懒挂载
  //   + keep-alive）：一个面板只有第一次被访问时才会创建/挂载，此后无论
  //   切到别的标签页多少次，它的组件实例、内部 state、正在进行的请求/
  //   流式连接都不会被销毁，只是隐藏起来；切回来的时候是原样恢复，不是
  //   重新加载。
  const [visited, setVisited] = useState(() => new Set(['health']))

  // ★ HITL 改动：监听其他面板（比如 ChatPanel 检测到 interrupt）发出的
  //   "请切换到某个面板" 意图，见 lib/shared.js 的说明。
  useEffect(() => onNavigate((tabId) => setActive(tabId)), [])

  // 每次激活的标签页变化时，把它记入"访问过"的集合（已经在集合里则不产生
  // 新的 Set，避免无意义的重渲染）。
  useEffect(() => {
    setVisited(prev => (prev.has(active) ? prev : new Set(prev).add(active)))
  }, [active])

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
    review:    <TaskReviewPanel />,
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
    review:    { title:'人工审核',         desc:'任务计划状态 · 失败重试 / 高风险审批 · 断点恢复' },
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
                  title={item.id === 'review' && isAwaiting ? `${gateCount} 项待处理` : undefined}
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
                  {item.id === 'review' && isAwaiting && (
                    <span style={styles.errDot} />
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
          {/* 只渲染"访问过"的面板（懒挂载），已挂载的面板切走时不卸载，
              而是用 display:none 隐藏，保持组件实例和内部 state 存活。
              key 用面板 id，保证 React 复用同一个组件实例而不是重新创建。 */}
          {[...visited].map(id => (
            <div
              key={id}
              style={{
                ...styles.panelSlot,
                display: active === id ? 'flex' : 'none',
              }}
            >
              {panels[id]}
            </div>
          ))}
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
  sidebar: { gridArea:'sidebar', minHeight:0, background:'var(--s1)', borderRight:'1px solid var(--border)', padding:'14px 0', display:'flex', flexDirection:'column', gap:2, overflowY:'auto' },
  navSection: { fontFamily:'var(--mono)', fontSize:10, fontWeight:600, color:'var(--sub)', letterSpacing:'.1em', textTransform:'uppercase', padding:'10px 18px 4px' },
  navItem: { display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 18px', fontSize:13, fontWeight:500, border:'none', borderLeft:'3px solid transparent', cursor:'pointer', transition:'all .15s', textAlign:'left', fontFamily:'var(--sans)', background:'transparent', position:'relative' },
  errDot: { marginLeft:'auto', width:6, height:6, borderRadius:'50%', background:'var(--err)', boxShadow:'0 0 6px var(--err)' },
  main: { gridArea:'main', minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' },
  panelHeader: { padding:'14px 24px', borderBottom:'1px solid var(--border)', flexShrink:0 },
  panelTitle: { fontFamily:'var(--mono)', fontSize:15, fontWeight:700, color:'var(--text)' },
  panelDesc: { fontSize:12, color:'var(--sub)', marginTop:2 },
  // ★ Bugfix：这里之前自己也开了 overflowY:'auto'，跟每个面板内部自己的
  //   滚动区域（比如 BatchPanel 结果列表那个 overflowY:'scroll' 的 div）
  //   形成了两层嵌套的滚动容器。因为内层 flex 子元素几乎正好撑满这一层的
  //   高度，外层这条 overflow:auto 基本没有真实溢出量，它的滚动条看起来
  //   贴着窗口右边缘存在，但滑块拖不动内容；同时它还挡在真正需要滚动的
  //   内层滚动条前面，干扰其鼠标/触摸事件——表现出来就是"右边这条滚动条
  //   不工作"。panelBody 只负责占满可用空间，滚动完全交给各面板自己内部
  //   的滚动区域（跟 ChatPanel/MultiTurnPanel/HealthPanel/SessionPanel 已经
  //   在用的模式保持一致），所以这里改成 overflow:'hidden'，不再自己滚动。
  panelBody: { flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column', position:'relative' },
  // 每个面板的容器：占满 panelBody 的空间。非激活时 display:none（在上面
  // 内联样式里覆盖），激活时 flex 撑满，宽度用 100% 保证跟之前单面板渲染
  // 时的布局完全一致。
  panelSlot: { flex:1, minHeight:0, width:'100%', flexDirection:'column' },
}