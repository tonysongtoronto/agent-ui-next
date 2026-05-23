// app/api/traces/[runId]/route.js
// GET /api/traces/:runId → 单条 run 详情 + 子 run

import { getRun, getChildRuns } from '../../../../lib/langsmith'

export async function GET(request, { params }) {


  const { runId } = await params
  try {
    const [run, children] = await Promise.all([
      getRun(runId),
      getChildRuns(runId),
    ])
    return Response.json({ run, children })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 })
  }
}
