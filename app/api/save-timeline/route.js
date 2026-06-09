import fs from 'fs'
import path from 'path'

export async function POST(req) {
  const data = await req.json()
  const dir = path.join(process.cwd(), 'timeline_logs')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `timeline_${Date.now()}.json`),
    JSON.stringify(data, null, 2)
  )
  return Response.json({ ok: true })
}