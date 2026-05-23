// app/api/test/route.js
// GET /api/test  →  Hello World
// POST /api/test →  模拟 prompt 创建（无数据库）

export async function GET() {
  return Response.json({ message: "Hello World" })
}

export async function POST(request) {
  try {
    const { title, content, tags } = await request.json()

    if (!title?.trim())   return Response.json({ error: 'title 不能为空'   }, { status: 400 })
    if (!content?.trim()) return Response.json({ error: 'content 不能为空' }, { status: 400 })

    // ✅ 不用数据库，直接构造假数据返回
    const prompt = {
      id:        Math.floor(Math.random() * 1000),
      title:     title.trim(),
      content:   content.trim(),
      tags:      (tags ?? '').trim(),
      createdAt: new Date().toISOString(),
    }

    return Response.json({ prompt })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}