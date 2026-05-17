// app/api/ui/prompts/[id]/route.js
// PATCH  /api/ui/prompts/:id → 更新 prompt
// DELETE /api/ui/prompts/:id → 删除 prompt

import { dbUpdatePrompt, dbDeletePrompt } from '../../../../../lib/db'

export async function PATCH(request, { params }) {
  const { id } = await params
  try {
    const body = await request.json()
    const prompt = await dbUpdatePrompt(id, body)
    return Response.json({ prompt })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params
  try {
    await dbDeletePrompt(id)
    return Response.json({ success: true, id })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
