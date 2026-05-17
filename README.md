# Agent UI — Next.js 版本

原 Vite + React 项目迁移到 Next.js 14（App Router）。

---

## 目录结构（与原版对比）

```
agent-ui-next/
  app/
    layout.js          ← 原 index.html + main.jsx → 根布局（Server Component）
    page.js            ← 根路由，渲染 AppShell
    globals.css        ← 原 index.css（设计 token + 动画）
  components/
    AppShell.jsx       ← 原 App.jsx（'use client'）
    HealthPanel.jsx    ← 原样搬迁，加 'use client'
    ChatPanel.jsx      ← 原样搬迁，加 'use client'
    BatchPanel.jsx     ← 原样搬迁，加 'use client'
    MultiTurnPanel.jsx ← 原样搬迁，加 'use client'
    SessionPanel.jsx   ← 原样搬迁，加 'use client'
    MemoryPanel.jsx    ← 原样搬迁，加 'use client'
  hooks/
    useHealth.js       ← 原样搬迁（路径更新）
  lib/
    client.js          ← 原 api/client.js（修复 localStorage SSR 问题）
  next.config.js       ← 原 vite.config.js
  package.json
```

---

## 迁移要点（学习笔记）

### 1. 'use client' 指令
Next.js 默认所有组件是 **Server Component（服务端组件）**，服务端没有：
- React 状态（useState / useReducer）
- 副作用（useEffect）
- 浏览器 API（localStorage / window / document）
- 事件监听（onClick 等）

凡是用到以上功能的组件，**第一行必须写 `'use client'`**。

本项目所有 Panel 组件都用了 useState，所以全部加了 'use client'。

### 2. localStorage 的 SSR 问题
原版 `client.js` 在模块顶层直接读 localStorage：
```js
// ❌ 原版（Vite 无问题，Next.js 报错）
let _baseUrl = localStorage.getItem('agentBaseUrl') || 'http://localhost:8000'
```

Next.js 在构建时会在服务端执行模块代码，服务端没有 localStorage，会报 `ReferenceError`。

修复方法：
```js
// ✅ Next.js 版本
export const getBaseUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:8000'  // 服务端
  if (!_baseUrl) _baseUrl = localStorage.getItem('agentBaseUrl') || 'http://localhost:8000'
  return _baseUrl
}
```

### 3. 文件结构变化
| 原 Vite | Next.js | 原因 |
|---------|---------|------|
| `index.html` | `app/layout.js` | Next.js 自动生成 HTML |
| `src/main.jsx` | `app/page.js` | App Router 路由入口 |
| `src/index.css` | `app/globals.css` | Next.js 约定 |
| `src/api/client.js` | `lib/client.js` | Next.js 约定工具放 lib/ |
| `vite.config.js` | `next.config.js` | 构建配置 |

---

## 启动方法

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:3000）
npm run dev
```

---

## 下一步（第二阶段）

用 Next.js API Routes 替代部分 Python 接口：

```
app/
  api/
    health/
      route.js    ← GET /api/health
    chat/
      route.js    ← POST /api/chat
```

这样就不需要 Python 后端了！
