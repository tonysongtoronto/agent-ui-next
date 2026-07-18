'use client'
// components/AgentToolsPanel.jsx
// Agent / Tools 一览页面 —— 布局仿照 HealthPanel.jsx
// 数据来源：复用 /api/health 返回的 agent_desc_block 字段，
//          前端解析成结构化的 { name, desc, tools[], scope } 列表。
//
// 轮询间隔特意设成 30s（比 HealthPanel 的 10s 更长），
// 因为 Agent / 工具配置基本是静态的，没必要跟状态检测同频轮询。

import { useMemo } from 'react'
import { useHealth } from '../hooks/useHealth.js'
import { RefreshCw, Bot, Wrench, Sparkles } from 'lucide-react'

// 解析后端拼好的中文描述文本：
//   "  - http_agent：网络请求（GET/POST...）（工具：fetch_url, post_json）"
//   "  - direct：直接用语言模型回答，不调用任何工具（仅限：闲聊/问候/概念解释/知识性问答）"
function parseAgentDescBlock(text) {
  if (!text) return []
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('-'))
    .map(line => {
      const body = line.replace(/^-\s*/, '')
      const colonIdx = body.indexOf('：')
      if (colonIdx === -1) return { name: body, desc: '', tools: [], scope: null }

      const name = body.slice(0, colonIdx)
      let rest = body.slice(colonIdx + 1)
      let tools = []
      let scope = null

      const toolMatch = rest.match(/（工具：([^）]+)）\s*$/)
      if (toolMatch) {
        tools = toolMatch[1].split(/[,，、]\s*/).map(s => s.trim()).filter(Boolean)
        rest = rest.slice(0, toolMatch.index).trim()
      } else {
        const scopeMatch = rest.match(/（仅限：([^）]+)）\s*$/)
        if (scopeMatch) {
          scope = scopeMatch[1]
          rest = rest.slice(0, scopeMatch.index).trim()
        }
      }
      return { name, desc: rest, tools, scope }
    })
}

export default function AgentToolsPanel() {
  const { data, status, loading, refresh } = useHealth(30000)

  const agents = useMemo(
  () => parseAgentDescBlock(data?.agent_desc_block),
  [data?.agent_desc_block]
)
  const toolTotal = data?.tool_count ?? agents.reduce((n, a) => n + a.tools.length, 0)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20, padding:20, overflowY:'auto' }} className="fade-up">

      {/* Overview card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <Bot size={15} color="var(--accent)" />
          <span style={styles.cardTitle}>Agent 概览</span>
          <button onClick={refresh} disabled={loading} style={styles.refreshBtn} title="刷新">
            <RefreshCw size={13} style={{ animation: loading ? 'spin .6s linear infinite' : 'none' }} />
          </button>
        </div>

        <div style={styles.metaGrid}>
          <MetaItem icon={<Bot size={13}/>}    label="Agent 数量" value={`${agents.length} 个`} />
          <MetaItem icon={<Wrench size={13}/>} label="工具总数"   value={`${toolTotal} 个`} />
        </div>
      </div>

      {/* Agent cards */}
      {agents.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {agents.map(a => (
            <div key={a.name} style={styles.card}>
              <div style={styles.cardHeader}>
                <Bot size={14} color="var(--accent2)" />
                <span style={styles.agentName}>{a.name}</span>
                {a.tools.length > 0 && (
                  <span style={styles.toolCount}>{a.tools.length} 个工具</span>
                )}
              </div>

              {a.desc && <div style={styles.agentDesc}>{a.desc}</div>}

              {a.tools.length > 0 ? (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:12 }}>
                  {a.tools.map(t => (
                    <span key={t} style={styles.toolBadge}>
                      <Wrench size={11} style={{ marginRight:5, opacity:.7 }} />
                      {t}
                    </span>
                  ))}
                </div>
              ) : a.scope ? (
                <div style={styles.scopeBox}>
                  <Sparkles size={13} color="var(--accent3)" style={{ marginRight:6, flexShrink:0 }} />
                  仅限：{a.scope}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div style={styles.errBox}>
          ✗ 无法连接后端，请确认 uvicorn 已启动，并检查上方 Base URL 是否正确。
        </div>
      )}

      {status !== 'error' && !loading && agents.length === 0 && (
        <div style={styles.errBox}>
          未解析到 Agent 信息，请确认后端 /health 返回了 agent_desc_block 字段。
        </div>
      )}
    </div>
  )
}

function MetaItem({ icon, label, value }) {
  return (
    <div style={styles.metaItem}>
      <span style={{ color:'var(--sub)', display:'flex', alignItems:'center', gap:5 }}>{icon}{label}</span>
      <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--text)' }}>{value}</span>
    </div>
  )
}

const styles = {
  card: {
    background:'var(--s1)', border:'1px solid var(--border)',
    borderRadius:'var(--r-lg)', padding:'18px 20px',
  },
  cardHeader: { display:'flex', alignItems:'center', gap:8 },
  cardTitle: {
    fontFamily:'var(--mono)', fontSize:12, fontWeight:600,
    color:'var(--sub)', letterSpacing:'.06em', textTransform:'uppercase', flex:1,
  },
  refreshBtn: {
    background:'none', border:'none', cursor:'pointer',
    color:'var(--sub)', padding:4, display:'flex', alignItems:'center',
    borderRadius:6, transition:'color .15s',
  },
  metaGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:16 },
  metaItem: {
    background:'var(--s2)', border:'1px solid var(--border)',
    borderRadius:8, padding:'10px 14px',
    display:'flex', flexDirection:'column', gap:4,
    fontSize:12, fontFamily:'var(--mono)',
  },
  agentName: {
    fontFamily:'var(--mono)', fontSize:13.5, fontWeight:700,
    color:'var(--text)', flex:1,
  },
  toolCount: {
    fontFamily:'var(--mono)', fontSize:11, color:'var(--sub)',
  },
  agentDesc: {
    marginTop:10, fontSize:13, color:'var(--sub)', lineHeight:1.6,
  },
  toolBadge: {
    display:'inline-flex', alignItems:'center',
    background:'rgba(91,156,246,.08)', border:'1px solid rgba(91,156,246,.2)',
    color:'var(--accent)', borderRadius:99, padding:'4px 12px',
    fontSize:11.5, fontFamily:'var(--mono)', fontWeight:500,
  },
  scopeBox: {
    marginTop:12, display:'flex', alignItems:'center',
    background:'rgba(167,139,250,.08)', border:'1px solid rgba(167,139,250,.2)',
    borderRadius:8, padding:'8px 12px',
    fontSize:12.5, fontFamily:'var(--mono)', color:'var(--accent3)',
  },
  errBox: {
    background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.25)',
    borderRadius:'var(--r)', padding:'14px 18px', color:'var(--err)',
    fontSize:13, fontFamily:'var(--mono)',
  },
}
