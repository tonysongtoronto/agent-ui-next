// hooks/useHealth.js
// ────────────────────────────────────────────────────────
// ⚠️  Next.js 注意：这个文件本身不用加 'use client'，
//     但是调用它的组件必须是客户端组件（加了 'use client'）。
//     Hook 只能在客户端组件里用。
// ────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { apiHealth } from '../lib/client.js'

export function useHealth(autoRefreshMs = 15000) {
  const [data,    setData]    = useState(null)
  const [status,  setStatus]  = useState('idle') // idle | ok | degraded | initializing | error
  const [loading, setLoading] = useState(false)
 const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const check = useCallback(async () => {
    setLoading(true)
    // await sleep(2000)   
    try {
      const res = await apiHealth()
     // console.log('health check res:\n' + JSON.stringify(res, null, 2))
      setData(res)
      setStatus(res.status)
    } catch {
      setStatus('error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    check()
    const timer = setInterval(check, autoRefreshMs)
    return () => clearInterval(timer)
  }, [check, autoRefreshMs])

  return { data, status, loading, refresh: check }
}
