import { describe, it, expect, vi } from 'vitest'
import { todoWriteTool } from '../src/tools/builtin/todo-write.js'
import { todoReadTool } from '../src/tools/builtin/todo-read.js'

function content(result: unknown): string { return typeof result === 'string' ? result : (result as { content: string }).content }

function makeCtx(todos: any[] = []) {
  const session: any = { todos }
  const onTodosUpdate = vi.fn()
  const ctx: any = { session, events: { onTodosUpdate } }
  return { ctx, session, onTodosUpdate }
}

describe('TodoWrite', () => {
  it('replaces the session todos and fires onTodosUpdate', async () => {
    const { ctx, session, onTodosUpdate } = makeCtx()
    const items = [
      { id: '1', content: 'Write tests', status: 'in_progress', priority: 'high' },
      { id: '2', content: 'Deploy', status: 'pending', priority: 'medium' },
    ]

    const result = await todoWriteTool.execute({ items }, ctx)

    expect(session.todos).toEqual(items)
    expect(onTodosUpdate).toHaveBeenCalledWith(items)
    expect(content(result)).toContain('2 todo')
  })

  it('validates status and priority values', async () => {
    const { ctx } = makeCtx()
    const result = await todoWriteTool.execute(
      { items: [{ id: '1', content: 'x', status: 'done', priority: 'critical' }] },
      ctx
    )
    expect(content(result)).toContain('Error')
  })
})

describe('TodoRead', () => {
  it('returns JSON of current todos', async () => {
    const items = [{ id: '1', content: 'Foo', status: 'pending', priority: 'low' }]
    const { ctx } = makeCtx(items)

    const result = await todoReadTool.execute({}, ctx)
    expect(JSON.parse(content(result))).toEqual(items)
  })

  it('returns empty array when no todos', async () => {
    const { ctx } = makeCtx()
    const result = await todoReadTool.execute({}, ctx)
    expect(JSON.parse(content(result))).toEqual([])
  })
})
