import WebSocket from 'ws'
import * as readline from 'readline'
import { userInfo } from 'os'
import { ClientMessage, ServerMessage } from '../types.js'

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')
const ws = new WebSocket(`ws://localhost:${PORT}`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
})

const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg))

ws.on('open', () => {
  send({ type: 'hello', user_id: process.env.HARNESS_USER ?? userInfo().username })
  console.log(`Connected to harness (ws://localhost:${PORT})`)
  console.log('Commands: /exit  /cancel  /resume <session-id>')
  prompt()
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage
  switch (msg.type) {
    case 'token':
      process.stdout.write(msg.content)
      break
    case 'tool_start':
      process.stdout.write(`\n[tool:start] ${msg.name} ${JSON.stringify(msg.input)}\n`)
      break
    case 'tool_end':
      process.stdout.write(`[tool:end] ${msg.name}\n`)
      break
    case 'tool_prompt':
      rl.question(
        `\n[permission] Allow "${msg.name}"?\n  Input: ${JSON.stringify(msg.input)}\n  [y/N] `,
        (ans) => {
          send(
            ans.trim().toLowerCase() === 'y'
              ? { type: 'tool_approve', id: msg.id }
              : { type: 'tool_deny', id: msg.id }
          )
        }
      )
      break
    case 'session_end':
      process.stdout.write(`\n[session: ${msg.sessionId}]\n`)
      prompt()
      break
    case 'session_resumed':
      process.stdout.write(`\n[resumed: ${msg.sessionId}]\n`)
      prompt()
      break
    case 'error':
      process.stdout.write(`\n[error] ${msg.message}\n`)
      prompt()
      break
  }
})

ws.on('close', () => { console.log('\nDisconnected.'); process.exit(0) })
ws.on('error', (e) => { console.error('Connection error:', e.message); process.exit(1) })

function prompt() {
  rl.question('> ', (input) => {
    const trimmed = input.trim()
    if (!trimmed) { prompt(); return }
    if (trimmed === '/exit') { ws.close(); rl.close(); return }
    if (trimmed === '/cancel') { send({ type: 'cancel' }); prompt(); return }
    if (trimmed.startsWith('/resume ')) {
      send({ type: 'resume', sessionId: trimmed.slice(8).trim() })
      return
    }
    send({ type: 'message', content: trimmed })
  })
}
