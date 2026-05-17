// lib/db.js
// ────────────────────────────────────────────────────────
// Next.js 独立数据层 — SQLite（@libsql/client）
//
// 存什么：
//   sessions  — 会话别名、Pin、备注（对应 LangGraph thread_id）
//   prompts   — 常用 Prompt 收藏夹
//   prefs     — 用户偏好（主题、界面配置等）
//
// 文件位置：
//   prisma/ui.db（项目目录下，gitignore 已排除）
//
// 这份数据和 Python api.py 的 checkpoints.db 完全独立：
//   checkpoints.db → 对话历史、LangGraph 状态（Python 管）
//   ui.db          → UI 元数据、用户配置（Next.js 管）
//
// 单例模式：Node.js 模块缓存保证进程内只有一个连接实例。
// ────────────────────────────────────────────────────────

import { createClient } from '@libsql/client'
import path from 'path'

// DATABASE_URL 可在 .env.local 里覆盖，默认放在 prisma/ 目录
const DB_PATH = process.env.UI_DATABASE_URL
  ?? `file:${path.join(process.cwd(), 'prisma', 'ui.db')}`

// 单例
let _db = null

export function getDb() {
  if (!_db) {
    _db = createClient({ url: DB_PATH })
  }
  return _db
}

// ── Schema 初始化 ─────────────────────────────────────
// 在 Next.js 启动后第一次调用时执行，幂等（IF NOT EXISTS）
let _initialized = false

export async function initDb() {
  if (_initialized) return
  const db = getDb()

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      thread_id  TEXT UNIQUE NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      pinned     INTEGER NOT NULL DEFAULT 0,
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prefs (
      id   TEXT PRIMARY KEY DEFAULT 'singleton',
      data TEXT NOT NULL DEFAULT '{}'
    );

    INSERT OR IGNORE INTO prefs (id, data) VALUES ('singleton', '{}');
  `)

  _initialized = true
}

// ── 工具函数：生成 cuid 风格的简短 ID ─────────────────
// 不依赖外部库，用 crypto.randomUUID() 截取即可
export function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20)
}

// ── Session CRUD ──────────────────────────────────────

export async function dbListSessions() {
  await initDb()
  const db = getDb()
  const res = await db.execute(
    `SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC`
  )
  return res.rows.map(rowToObj)
}

export async function dbUpsertSession(thread_id, { label, pinned, note } = {}) {
  await initDb()
  const db = getDb()
  // 查是否已存在
  const exist = await db.execute(
    `SELECT id FROM sessions WHERE thread_id = ?`, [thread_id]
  )
  if (exist.rows.length > 0) {
    // 更新
    const fields = []
    const vals   = []
    if (label   !== undefined) { fields.push('label = ?');  vals.push(label) }
    if (pinned  !== undefined) { fields.push('pinned = ?'); vals.push(pinned ? 1 : 0) }
    if (note    !== undefined) { fields.push('note = ?');   vals.push(note) }
    if (fields.length === 0) return null
    fields.push("updated_at = datetime('now')")
    vals.push(thread_id)
    await db.execute(
      `UPDATE sessions SET ${fields.join(', ')} WHERE thread_id = ?`, vals
    )
  } else {
    // 插入
    await db.execute(
      `INSERT INTO sessions (id, thread_id, label, pinned, note)
       VALUES (?, ?, ?, ?, ?)`,
      [newId(), thread_id, label ?? '', pinned ? 1 : 0, note ?? '']
    )
  }
  const row = await db.execute(
    `SELECT * FROM sessions WHERE thread_id = ?`, [thread_id]
  )
  return rowToObj(row.rows[0])
}

export async function dbDeleteSession(thread_id) {
  await initDb()
  const db = getDb()
  await db.execute(`DELETE FROM sessions WHERE thread_id = ?`, [thread_id])
}

// ── Prompt CRUD ───────────────────────────────────────

export async function dbListPrompts() {
  await initDb()
  const db = getDb()
  const res = await db.execute(
    `SELECT * FROM prompts ORDER BY updated_at DESC`
  )
  return res.rows.map(rowToObj)
}

export async function dbCreatePrompt({ title, content, tags = '' }) {
  await initDb()
  const db = getDb()
  const id = newId()
  await db.execute(
    `INSERT INTO prompts (id, title, content, tags) VALUES (?, ?, ?, ?)`,
    [id, title, content, tags]
  )
  const row = await db.execute(`SELECT * FROM prompts WHERE id = ?`, [id])
  return rowToObj(row.rows[0])
}

export async function dbUpdatePrompt(id, { title, content, tags }) {
  await initDb()
  const db = getDb()
  const fields = []
  const vals   = []
  if (title   !== undefined) { fields.push('title = ?');   vals.push(title) }
  if (content !== undefined) { fields.push('content = ?'); vals.push(content) }
  if (tags    !== undefined) { fields.push('tags = ?');    vals.push(tags) }
  if (fields.length === 0) return null
  fields.push("updated_at = datetime('now')")
  vals.push(id)
  await db.execute(
    `UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`, vals
  )
  const row = await db.execute(`SELECT * FROM prompts WHERE id = ?`, [id])
  return rowToObj(row.rows[0])
}

export async function dbDeletePrompt(id) {
  await initDb()
  const db = getDb()
  await db.execute(`DELETE FROM prompts WHERE id = ?`, [id])
}

// ── Prefs ─────────────────────────────────────────────

export async function dbGetPrefs() {
  await initDb()
  const db = getDb()
  const row = await db.execute(`SELECT data FROM prefs WHERE id = 'singleton'`)
  try { return JSON.parse(row.rows[0]?.data ?? '{}') } catch { return {} }
}

export async function dbSetPrefs(patch) {
  await initDb()
  const db = getDb()
  const cur = await dbGetPrefs()
  const next = { ...cur, ...patch }
  await db.execute(
    `UPDATE prefs SET data = ? WHERE id = 'singleton'`,
    [JSON.stringify(next)]
  )
  return next
}

// ── 内部：把 libsql 的 Row 对象转成普通 JS 对象 ────────
function rowToObj(row) {
  if (!row) return null
  const obj = {}
  for (const [k, v] of Object.entries(row)) {
    // pinned 存为 0/1，转成 boolean
    if (k === 'pinned') { obj[k] = v === 1 || v === true; continue }
    obj[k] = v
  }
  return obj
}
