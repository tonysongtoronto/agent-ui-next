// app/api/ui/prompts/route.js
// GET  /api/ui/prompts → 所有收藏 prompt
// POST /api/ui/prompts → 新增 prompt

import { dbListPrompts, dbCreatePrompt } from '../../../../lib/db'

export async function GET() {
  try {
    const prompts = await dbListPrompts()
    return Response.json({ prompts })
  } catch (err) {
    return Response.json({ error: err.message }, )
  }
}

export async function POST(request) {
  try {
    const { title, content, tags } = await request.json()
    if (!title?.trim())   return Response.json({ error: 'title 不能为空'   }, { status: 400 })
    if (!content?.trim()) return Response.json({ error: 'content 不能为空' }, { status: 400 })
    const prompt = await dbCreatePrompt({
      title:   title.trim(),
      content: content.trim(),
      tags:    (tags ?? '').trim(),
    })
    return Response.json({ prompt })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
