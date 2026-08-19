// lib/shared.js
// ────────────────────────────────────────────────────────
// ★ HITL 改动：轻量的"跨面板共享"工具，不引入 Redux/Context，
//   延续本项目一贯的极简风格（参考 client.js 里 baseUrl 用
//   localStorage 持久化的做法）。
//
// 解决两个问题：
//   1. ChatPanel 发消息用的 thread_id / user_id，怎么让新加的
//      「人工审核」面板自动知道，不用用户手动复制粘贴。
//      → 存进 localStorage，TaskReviewPanel 挂载时读取。
//
//   2. ChatPanel 检测到某轮对话被 interrupt() 冻结后，怎么让用户
//      一键跳转到「人工审核」面板。
//      → AppShell 是唯一持有 `active` tab 状态的地方，但 ChatPanel
//        是它的子组件，不方便再往下传函数（本项目组件之间目前都是
//        平级、无props传递关系）。用一个全局 CustomEvent 广播导航
//        意图，AppShell 监听后调用自己的 setActive，这是最小侵入
//        的做法，不需要重构成 Context/状态提升。
// ────────────────────────────────────────────────────────

const THREAD_KEY = 'agentCurrentThread'   // localStorage key，存 { userId, threadId }
const NAV_EVENT  = 'agent:navigate'        // CustomEvent 名称

// ── 当前会话（thread_id + user_id）共享 ─────────────────

/**
 * 读取最近一次在 ChatPanel（或其他面板）里使用过的 thread_id / user_id。
 * 找不到时返回 { userId: 'default', threadId: '' }。
 */
export function getCurrentThread() {
  if (typeof window === 'undefined') return { userId: 'default', threadId: '' }
  try {
    const raw = localStorage.getItem(THREAD_KEY)
    if (!raw) return { userId: 'default', threadId: '' }
    const parsed = JSON.parse(raw)
    return {
      userId:   parsed.userId   || 'default',
      threadId: parsed.threadId || '',
    }
  } catch {
    return { userId: 'default', threadId: '' }
  }
}

/**
 * 更新当前会话（任何一个面板产生了新的 thread_id/user_id 都可以调用，
 * 不要求所有面板同步——只是"提供一个合理的默认值"，用户随时可以在
 * 各面板里手动改成别的 thread_id）。
 */
export function setCurrentThread({ userId, threadId }) {
  if (typeof window === 'undefined') return
  const prev = getCurrentThread()
  const next = {
    userId:   userId   ?? prev.userId,
    threadId: threadId ?? prev.threadId,
  }
  localStorage.setItem(THREAD_KEY, JSON.stringify(next))
  // 通知同一页面内其他已挂载的组件（比如 TaskReviewPanel 正开着）
  // localStorage 的 'storage' 事件只在"其他标签页"触发，同页面内
  // 需要自己广播一个事件才能让兄弟组件感知到变化。
  window.dispatchEvent(new CustomEvent(THREAD_KEY, { detail: next }))
}

/**
 * 订阅当前会话变化（同页面内）。返回取消订阅函数。
 */
export function onCurrentThreadChange(callback) {
  if (typeof window === 'undefined') return () => {}
  const handler = (e) => callback(e.detail)
  window.addEventListener(THREAD_KEY, handler)
  return () => window.removeEventListener(THREAD_KEY, handler)
}

// ── 跨面板导航事件总线 ────────────────────────────────────

/**
 * 广播"请切换到某个面板"的意图。AppShell 监听后执行 setActive。
 * @param {string} tabId - NAV 数组里的 id，比如 'review'
 */
export function navigateTo(tabId) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { tabId } }))
}

/**
 * 订阅导航事件（只应该在 AppShell 里用一次）。返回取消订阅函数。
 */
export function onNavigate(callback) {
  if (typeof window === 'undefined') return () => {}
  const handler = (e) => callback(e.detail.tabId)
  window.addEventListener(NAV_EVENT, handler)
  return () => window.removeEventListener(NAV_EVENT, handler)
}
