export async function DELETE(request, { params }) {
  try {
    const { id } = params

    // ✅ 模拟删除，不用数据库
    if (!id) {
      return Response.json({ error: 'id 不能为空' }, { status: 400 })
    }

    return Response.json({ 
      success: true, 
      deleted: { id, deletedAt: new Date().toISOString() } 
    })

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}