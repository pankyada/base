import { createServer } from 'node:http'

const port = Number(process.env.CLIENT_ACCEPTANCE_PROVIDER_PORT || 0)
let calls = 0
const auditTurns = new Map()
const server = createServer((req, res) => {
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
    return
  }
  if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
  let body = ''
  req.on('data', chunk => { body += chunk.toString() })
  req.on('end', () => {
    calls += 1
    const request = body ? JSON.parse(body) : {}
    const raw = JSON.stringify(request)
    const auditKey = raw.includes('CA_AUDIT_A') ? 'a' : raw.includes('CA_AUDIT_B') ? 'b' : null
    const hasToolResult = Array.isArray(request.messages) && request.messages.some(message => message?.role === 'tool')
    const auditCall = auditKey && !hasToolResult
    const datasetCall = raw.includes('CA_DATASET') && !hasToolResult
    if (auditKey) auditTurns.set(auditKey, (auditTurns.get(auditKey) ?? 0) + 1)
    const payload = JSON.stringify({ calls, body: request })
    process.stdout.write(`FAKE_PROVIDER_CALL ${payload}\n`)
    const delay = raw.includes('CA_SLOW') ? 900 : 0
    setTimeout(() => {
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
    if (auditCall) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${auditKey}`, type: 'function', function: { name: 'Bash', arguments: '{"command":"printf CA_AUDIT_' + auditKey.toUpperCase() + '"}' } }] } }] })}\n\n`)
    } else if (datasetCall) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-dataset', type: 'function', function: { name: 'RenderUI', arguments: '{"title":"CA dataset surface","html":"<p>CA_DATASET_SURFACE</p>"}' } }] } }] })}\n\n`)
    } else {
      const content = raw.includes('CA_SLOW') ? 'fixture slow complete' : raw.includes('CA_SCOPE_A') ? 'fixture A complete' : raw.includes('CA_SCOPE_B') ? 'fixture B complete' : 'fixture complete'
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 2, completion_tokens: 2 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    }, delay)
  })
})
server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`FAKE_PROVIDER_READY ${typeof address === 'object' && address ? address.port : ''}\n`)
})
const stop = () => server.close(() => process.exit(0))
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
