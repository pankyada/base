import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Box, useApp, useInput, Text } from 'ink'
import { useWs } from './hooks/use-ws.js'
import { TopBar } from './components/TopBar.js'
import { StatusBar } from './components/StatusBar.js'
import { ConvColumn } from './components/ConvColumn.js'
import { Workspace } from './components/Workspace.js'
import { Palette } from './components/Palette.js'
import { Hero } from './components/Hero.js'
import { Message } from './components/Message.js'
import { AgentTurn } from './components/AgentTurn.js'
import { Composer } from './components/Composer.js'
import { GenWidget } from './widgets/GenWidget.js'
import { Tab } from './components/TabBar.js'
import { C } from './theme.js'
import { useTermSize } from './hooks/useTermSize.js'
import { convWidth, workWidth } from './layout.js'
import type { ClientMessage, ServerMessage, UIMessage, ArtifactWidget } from '../types.js'

const PROFILE = process.env.HARNESS_PROFILE ?? 'coding'
const SESSION_ID = Math.random().toString(36).slice(2, 10)

interface TabState extends Tab {
  artifacts: ArtifactWidget[]
}

export function App() {
  const { exit } = useApp()
  const { cols, rows } = useTermSize()

  const [messages, setMessages] = useState<UIMessage[]>([])
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [focusPane, setFocusPane] = useState<'conv'|'work'>('conv')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tokens, setTokens] = useState({ in: 0, out: 0 })
  const [theme, setTheme] = useState('dark')

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'token') {
      setMessages(prev => {
        const m = [...prev]
        const last = m[m.length - 1]
        if (last && last.role === 'agent') {
          m[m.length - 1] = { ...last, content: (last.content || '') + msg.content }
        } else {
          m.push({ id: Math.random().toString(), role: 'agent', content: msg.content })
        }
        return m
      })
    }
    if (msg.type === 'tool_start') {
      setMessages(prev => [...prev, { id: Math.random().toString(), role: 'tool-call', name: msg.name, input: msg.input, status: 'running' }])
    }
    if (msg.type === 'tool_end') {
      setMessages(prev => {
        const m = [...prev]
        let idx = -1
        for (let i = m.length - 1; i >= 0; i--) {
          if (m[i].role === 'tool-call' && m[i].name === msg.name && m[i].status === 'running') {
            idx = i
            break
          }
        }
        if (idx >= 0) m[idx] = { ...m[idx], status: 'done', result: msg.result }
        return m
      })
    }
    if (msg.type === 'stats') setTokens({ in: msg.tokens_in, out: msg.tokens_out })
    if (msg.type === 'session_end' || msg.type === 'error') setBusy(false)
    if (msg.type === 'artifacts') {
      setTabs(prev => [...prev, { id: Math.random().toString(), label: 'Artifacts', artifacts: msg.artifacts }])
      setActiveTab(prev => prev)
    }
  }, [])

  const { connected, send } = useWs(handleMessage)

  const handleSend = (value: string) => {
    if (!value.trim()) return
    setMessages(prev => [...prev, { id: Math.random().toString(), role: 'user', content: value }])
    setBusy(true)
    setInput('')
    send({ type: 'message', content: value })
  }

  const handleSuggest = (id: string) => {
    const value = `Run the ${id} task.`
    handleSend(value)
  }

  const handleClear = () => {
    setMessages([])
    setTabs([])
    setBusy(false)
  }

  useInput((keyInput, key) => {
    if (key.ctrl && keyInput === 'k') { setPaletteOpen(o => !o); return }
    if (key.ctrl && keyInput === 'l') { handleClear(); return }
    if (key.escape) { setPaletteOpen(false); return }
    if (keyInput === '/') { setFocusPane('conv'); return }
    if (key.tab && tabs.length > 0) { setFocusPane(p => p === 'conv' ? 'work' : 'conv'); return }
    if (/^[1-9]$/.test(keyInput) && tabs.length > 0) {
      const idx = parseInt(keyInput) - 1
      if (idx < tabs.length) setActiveTab(idx)
      return
    }
  })

  const workspaceOpen = tabs.length > 0
  const cWidth = convWidth(cols, workspaceOpen)
  const wWidth = workWidth(cols, cWidth)

  const agentMessages = messages.filter(m => m.role === 'agent')
  const lastAgentMsg = agentMessages[agentMessages.length - 1]
  const toolMessages = messages.filter(m => m.role === 'tool-call')

  return (
    <Box flexDirection="column" height={rows}>
      <TopBar profileName={PROFILE} sessionId={SESSION_ID} busy={busy} />

      {!connected && (
        <Box backgroundColor={C.del} paddingX={1}>
          <Text color={C.bgDeep}>Disconnected. Waiting for reconnect...</Text>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="row">
        <Box width={cWidth} flexDirection="column">
          <ConvColumn split={workspaceOpen}>
            {messages.length === 0 ? (
              <Hero onSelect={handleSuggest} />
            ) : (
              <Box flexGrow={1} flexDirection="column">
                {messages.filter(m => m.role === 'user').map(m => (
                  <Message key={m.id} role="user" time="--:--:--">
                    <Text>{m.content}</Text>
                  </Message>
                ))}
                {(lastAgentMsg || toolMessages.length > 0) && (
                  <Message role="agent" time="--:--:--">
                    <AgentTurn message={lastAgentMsg || { id: '0', role: 'agent' }} tools={toolMessages} />
                  </Message>
                )}
              </Box>
            )}
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              busy={busy}
              compact={workspaceOpen}
            />
          </ConvColumn>
        </Box>

        {workspaceOpen && (
          <Box width={wWidth} flexDirection="column" marginLeft={2}>
            <Workspace tabs={tabs} activeTab={activeTab}>
              {tabs[activeTab]?.artifacts.map((a, i) => (
                <Box key={i} flexDirection="column" marginBottom={1}>
                  <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottomColor={C.border} marginBottom={1}>
                    <Text color={C.dim} bold>{a.icon} {a.title} {a.meta && `· ${a.meta}`}</Text>
                  </Box>
                  <GenWidget artifact={a} />
                </Box>
              ))}
            </Workspace>
          </Box>
        )}
      </Box>

      <StatusBar
        busy={busy}
        focusPane={focusPane}
        tokens={tokens}
        theme={theme}
      />

      {paletteOpen && (
        <Palette onClose={() => setPaletteOpen(false)} onRun={handleSuggest} onReset={handleClear} />
      )}
    </Box>
  )
}
