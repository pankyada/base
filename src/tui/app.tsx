import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Box, useApp, useInput, Text } from 'ink'
import { useWs } from './hooks/use-ws.js'
import { TopBar } from './components/TopBar.js'
import { StatusBar } from './components/StatusBar.js'
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
import type { ClientMessage, ServerMessage, UIMessage, ArtifactWidget, TodoItem, InputRequestKind } from '../types.js'
import type { Project } from '../projects/types.js'
import type { SessionSummary } from '../session/types.js'
import { InputRequestModal } from './components/InputRequestModal.js'
import { TodoPanel } from './components/TodoPanel.js'

const PROFILE = process.env.HARNESS_PROFILE ?? 'coding'
const SESSION_ID = Math.random().toString(36).slice(2, 10)

const now = () => new Date().toLocaleTimeString('en-US', { hour12: false })

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
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [tokens, setTokens] = useState({ in: 0, out: 0 })
  const [theme, setTheme] = useState('dark')
  const [pendingApproval, setPendingApproval] = useState<{ id: string; name: string; input: unknown } | null>(null)

  const [todos, setTodos] = useState<TodoItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [history, setHistory] = useState<SessionSummary[]>([])
  const [activeProject, setActiveProject] = useState('inbox')
  const [activeProjectName, setActiveProjectName] = useState('Inbox')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const assignedSessionRef = useRef<string | null>(null)

  const [pendingInputRequest, setPendingInputRequest] = useState<{
    id: string; prompt: string; kind: InputRequestKind; options?: string[]
    resolve: (v: string) => void
  } | null>(null)

  const pendingInputResolveRef = useRef<((v: string) => void) | null>(null)

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'token') {
      setMessages(prev => {
        const m = [...prev]
        const last = m[m.length - 1]
        if (last && last.role === 'agent') {
          m[m.length - 1] = { ...last, content: (last.content || '') + msg.content }
        } else {
          m.push({ id: Math.random().toString(), role: 'agent', time: now(), content: msg.content })
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
    if (msg.type === 'tool_prompt') {
      setPendingApproval({ id: msg.id, name: msg.name, input: msg.input })
    }
    if (msg.type === 'input_request') {
      pendingInputResolveRef.current = null
      setPendingInputRequest({
        id: msg.id,
        prompt: msg.prompt,
        kind: msg.kind,
        options: msg.options,
        resolve: (v: string) => {
          // Placeholder, will be reassigned inside send effect or handle Input response
        }
      })
    }
    if (msg.type === 'todos') {
      setTodos(msg.todos)
    }
    if (msg.type === 'session_ready') {
      setCurrentSessionId(msg.sessionId)
    }
    if (msg.type === 'projects') {
      setProjects(msg.projects)
    }
    if (msg.type === 'project_created') {
      setProjects(p => [...p, msg.project])
      setActiveProject(msg.project.id)
      setActiveProjectName(msg.project.name)
    }
    if (msg.type === 'sessions') {
      setHistory(msg.sessions)
    }
    if (msg.type === 'stats') setTokens({ in: msg.tokens_in, out: msg.tokens_out })
    if (msg.type === 'session_end' || msg.type === 'session_resumed') setBusy(false)
    if (msg.type === 'error') {
      setBusy(false)
      setMessages(prev => [...prev, { id: Math.random().toString(), role: 'agent', time: now(), content: `⚠ ${msg.message}` }])
    }
    if (msg.type === 'artifacts') {
      setTabs(prev => [...prev, { id: Math.random().toString(), label: 'Artifacts', artifacts: msg.artifacts }])
      setActiveTab(prev => prev)
    }
  }, [])

  const { connected, send } = useWs(handleMessage)

  // Auto-assign session to active project when session starts (once per session id)
  useEffect(() => {
    if (currentSessionId && activeProject !== 'inbox' && assignedSessionRef.current !== currentSessionId) {
      assignedSessionRef.current = currentSessionId
      send({ type: 'project_assign', sessionId: currentSessionId, projectId: activeProject })
    }
  }, [currentSessionId, activeProject, send])

  // Fix up the resolve callback now that we have `send`
  useEffect(() => {
    if (pendingInputRequest && !pendingInputResolveRef.current) {
      pendingInputResolveRef.current = (v: string) => {
        send({ type: 'input_response', id: pendingInputRequest.id, value: v })
      }
      setPendingInputRequest(prev => prev ? { ...prev, resolve: pendingInputResolveRef.current! } : null)
    }
  }, [pendingInputRequest, send])

  const handleInputResponse = (id: string, value: string) => {
    if (pendingInputRequest && pendingInputRequest.id === id) {
      pendingInputRequest.resolve(value)
      setPendingInputRequest(null)
    }
  }

  const handleSend = (value: string) => {
    if (!value.trim()) return
    setMessages(prev => [...prev, { id: Math.random().toString(), role: 'user', time: now(), content: value }])
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
    // While approval is pending, only y/n are handled
    if (pendingApproval) {
      if (keyInput === 'y') {
        send({ type: 'tool_approve', id: pendingApproval.id })
        setPendingApproval(null)
      } else if (keyInput === 'n') {
        send({ type: 'tool_deny', id: pendingApproval.id })
        setPendingApproval(null)
      }
      return
    }
    if (key.ctrl && keyInput === 'k') { setPaletteOpen(o => !o); return }
    if (key.ctrl && keyInput === 'l') { handleClear(); return }
    if (key.ctrl && keyInput === 'o') { setToolsExpanded(o => !o); return }
    if (key.escape) { if (paletteOpen) return; return }
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

  // Group messages into turns so all agent responses are visible in multi-turn conversations
  type Turn = { type: 'user'; msg: UIMessage } | { type: 'agent'; tools: UIMessage[]; agentMsg?: UIMessage }
  const turns = (() => {
    const result: Turn[] = []
    let cur: { tools: UIMessage[]; agentMsg?: UIMessage } | null = null
    for (const m of messages) {
      if (m.role === 'user') {
        if (cur) { result.push({ type: 'agent', ...cur }); cur = null }
        result.push({ type: 'user', msg: m })
      } else if (m.role === 'tool-call') {
        if (!cur) cur = { tools: [] }
        cur.tools.push(m)
      } else if (m.role === 'agent') {
        if (!cur) cur = { tools: [] }
        cur.agentMsg = m
      }
    }
    if (cur) result.push({ type: 'agent', ...cur })
    return result
  })()

  return (
    <Box flexDirection="column" height={rows}>
      <TopBar profileName={PROFILE} sessionId={SESSION_ID} busy={busy} activeProjectName={activeProjectName} />

      {!connected && (
        <Box backgroundColor={C.del} paddingX={1}>
          <Text color={C.bgDeep}>Disconnected. Waiting for reconnect...</Text>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="row" minHeight={0}>
        <Box width={cWidth} flexDirection="column" minHeight={0}>
          {/* Scroll viewport: fixed-height, clipped, pinned to newest (auto-tail) */}
          <Box flexGrow={1} flexDirection="column" justifyContent="flex-end" overflow="hidden" minHeight={0}>
            {messages.length === 0 ? (
              <Hero onSelect={handleSuggest} cols={cols} />
            ) : (
              <Box flexDirection="column">
                {turns.map((t, i) => t.type === 'user' ? (
                  <Message key={t.msg.id} role="user" time={t.msg.time ?? ''}>
                    <Text>{t.msg.content}</Text>
                  </Message>
                ) : (
                  <Message key={`agent-${i}`} role="agent" time={t.agentMsg?.time ?? ''}>
                    <AgentTurn message={t.agentMsg ?? {}} tools={t.tools} expanded={toolsExpanded} />
                  </Message>
                ))}
              </Box>
            )}
          </Box>
          {/* Fixed chrome below the viewport */}
          {todos.length > 0 && <TodoPanel todos={todos} />}
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            busy={busy}
            compact={workspaceOpen}
          />
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
        toolsExpanded={toolsExpanded}
      />

      {paletteOpen && (
        <Palette
          onClose={() => setPaletteOpen(false)}
          onRun={handleSuggest}
          onReset={handleClear}
          activeProject={activeProject}
          projects={projects}
          history={history}
          onRequestProjects={() => send({ type: 'project_list' })}
          onRequestHistory={(projectId) => send({ type: 'session_list', ...(projectId ? { projectId } : {}) })}
          onSwitchProject={(id, name) => {
            setActiveProject(id)
            setActiveProjectName(name)
            send({ type: 'session_list', projectId: id })
          }}
          onNewProject={(name) => send({ type: 'project_create', name })}
          onResume={(sessionId, project) => {
            send({ type: 'resume', sessionId })
            setActiveProject(project)
            const p = projects.find(x => x.id === project)
            setActiveProjectName(p?.name ?? 'Inbox')
          }}
          onAssign={(projectId) => {
            if (currentSessionId) {
              send({ type: 'project_assign', sessionId: currentSessionId, projectId })
            }
          }}
        />
      )}

      {pendingApproval && (
        <Box position="absolute" width="100%" height="100%" justifyContent="center" alignItems="center">
          <Box width={60} flexDirection="column" borderStyle="single" borderColor={C.accent} padding={1}>
            <Text color={C.accent} bold>Tool Approval Required</Text>
            <Text>Run: <Text color={C.info}>{pendingApproval.name}</Text></Text>
            <Text color={C.dim} wrap="truncate">{JSON.stringify(pendingApproval.input).slice(0, 120)}</Text>
            <Box marginTop={1}>
              <Text color={C.dim}>[y] Allow  [n] Deny</Text>
            </Box>
          </Box>
        </Box>
      )}

      {pendingInputRequest && (
        <InputRequestModal
          id={pendingInputRequest.id}
          prompt={pendingInputRequest.prompt}
          kind={pendingInputRequest.kind}
          options={pendingInputRequest.options}
          onSubmit={handleInputResponse}
        />
      )}
    </Box>
  )
}
