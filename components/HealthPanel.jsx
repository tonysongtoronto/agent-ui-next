'use client'
// components/HealthPanel.jsx
// 变化：顶部加了 'use client'，import 路径改为 '../hooks/useHealth'
// 组件逻辑和样式完全不变

import { useHealth } from '../hooks/useHealth.js'
import { RefreshCw, Server, Database, Cpu, Clock } from 'lucide-react'

const STATUS_COLOR = {
  ok:           'var(--ok)',
  degraded:     'var(--warn)',
  initializing: 'var(--accent)',
  error:        'var(--err)',
  idle:         'var(--sub)',
}

const STATUS_LABEL = {
  ok:           '✓ 正常运行',
  degraded:     '⚠ 降级运行',
  initializing: '⏳ 初始化中',
  error:        '✗ 连接失败',
  idle:         '— 未检测',
}

export default function HealthPanel() {
  const { data, status, loading, refresh } = useHealth(10000)
  const color = STATUS_COLOR[status] || 'var(--sub)'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20, padding:20, overflowY:'auto' }} className="fade-up">

      {/* Status card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <Server size={15} color="var(--accent)" />
          <span style={styles.cardTitle}>服务状态</span>
          <button onClick={refresh} disabled={loading} style={styles.refreshBtn} title="刷新">
            <RefreshCw size={13} style={{ animation: loading ? 'spin .6s linear infinite' : 'none' }} />
          </button>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:16 }}>
          <div style={{ ...styles.statusDot, background: color, boxShadow: `0 0 10px ${color}` }} />
          <span style={{ fontFamily:'var(--mono)', fontSize:20, fontWeight:700, color }}>{STATUS_LABEL[status]}</span>
        </div>

        {data && (
          <div style={styles.metaGrid}>
            <MetaItem icon={<Cpu size={13}/>}      label="工具数量" value={`${data.tool_count} 个`} />
            <MetaItem icon={<Clock size={13}/>}    label="运行时长" value={formatUptime(data.uptime_seconds)} />
            <MetaItem icon={<Database size={13}/>} label="数据库"   value={shortPath(data.checkpoint_db)} />
          </div>
        )}
      </div>

      {/* Agents list */}
      {data?.agents?.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <Cpu size={15} color="var(--accent2)" />
            <span style={styles.cardTitle}>已注册 Agents</span>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:14 }}>
            {data.agents.map(a => (
              <span key={a} style={styles.agentBadge}>{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON */}
      {data && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>原始响应</span>
          </div>
          <pre style={styles.pre}>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}

      {status === 'error' && (
        <div style={styles.errBox}>
          ✗ 无法连接后端，请确认 uvicorn 已启动，并检查上方 Base URL 是否正确。
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

function formatUptime(s) {
  if (!s) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s/60)}m ${Math.round(s%60)}s`
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
}

function shortPath(p) {
  if (!p) return '—'
  const parts = p.replace(/\\/g, '/').split('/')
  return '…/' + parts.slice(-2).join('/')
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
  statusDot: { width:14, height:14, borderRadius:'50%', flexShrink:0 },
  metaGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:16 },
  metaItem: {
    background:'var(--s2)', border:'1px solid var(--border)',
    borderRadius:8, padding:'10px 14px',
    display:'flex', flexDirection:'column', gap:4,
    fontSize:12, fontFamily:'var(--mono)',
  },
  agentBadge: {
    background:'rgba(29,233,182,.08)', border:'1px solid rgba(29,233,182,.2)',
    color:'var(--accent2)', borderRadius:99, padding:'4px 12px',
    fontSize:12, fontFamily:'var(--mono)', fontWeight:500,
  },
  pre: {
    marginTop:12, background:'var(--bg)', border:'1px solid var(--border)',
    borderRadius:8, padding:14, fontSize:11.5,
    fontFamily:'var(--mono)', color:'var(--sub)',
    overflowX:'auto', lineHeight:1.7,
  },
  errBox: {
    background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.25)',
    borderRadius:'var(--r)', padding:'14px 18px', color:'var(--err)',
    fontSize:13, fontFamily:'var(--mono)',
  },
}
