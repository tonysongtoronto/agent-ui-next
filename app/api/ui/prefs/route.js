// app/api/ui/prefs/route.js
// GET   /api/ui/prefs      → 读取用户偏好
// PATCH /api/ui/prefs      → 更新（merge patch，只改传入的字段）

import { dbGetPrefs, dbSetPrefs } from '../../../../lib/db'

export async function GET() {
  try {
    const prefs = await dbGetPrefs()
    return Response.json({ prefs })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const patch = await request.json()
    const prefs = await dbSetPrefs(patch)
    return Response.json({ prefs })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
