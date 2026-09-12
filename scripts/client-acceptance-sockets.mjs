// Test-only server transport probe; never loaded by normal harness startup.
import { WebSocketServer } from 'ws'
import { writeFileSync, renameSync } from 'node:fs'
const path = process.env.CLIENT_ACCEPTANCE_SOCKET_COUNT
if (path) {
  const original = WebSocketServer.prototype.emit
  const sockets = new Set()
  const record = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify({ active: sockets.size }))
    renameSync(`${path}.tmp`, path)
  }
  record()
  WebSocketServer.prototype.emit = function (event, ...args) {
    if (event === 'connection') {
      const socket = args[0]
      sockets.add(socket)
      record()
      socket.once('close', () => { sockets.delete(socket); record() })
    }
    return original.call(this, event, ...args)
  }
}
