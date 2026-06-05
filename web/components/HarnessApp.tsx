'use client'
import { useState, useReducer, useEffect, useRef } from 'react'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ConvColumn } from './ConvColumn'
import { Workspace } from './Workspace'
import { Palette } from './Palette'
import { Tweaks } from './Tweaks'
import { ApprovalModal } from './ApprovalModal'
import { Hero } from './Hero'
import { Message } from './Message'
import { AgentTurn } from './AgentTurn'
import { Composer } from './Composer'
import { useHarnessWS } from '../hooks/useHarnessWS'
import { UIMessage, WorkspaceTab, Artifact, TodoItem, InputRequestKind, ExecutionResult, Project, SessionSummary } from '../lib/types'
import { HarnessPython } from './HarnessPython'
import { InputRequestModal } from './InputRequestModal'
import { TodoPanel } from './TodoPanel'

export interface State {
  messages: UIMessage[]
  tabs: WorkspaceTab[]
  activeTab: number
  input: string
  busy: boolean
  focusPane: 'conv' | 'work'
  paletteOpen: boolean
  tokens: { in: number; out: number }
  pendingApproval: { id: string; name: string; input: unknown } | null
  tweaksOpen: boolean
  theme: string
  palette: string
  density: string
  todos: TodoItem[]
  profile: string
  sessionId: string
  pendingInputRequest: {
    id: string; prompt: string; kind: InputRequestKind; options?: string[]
  } | null
  pendingCodeExecution: { id: string; code: string; language: string; data?: Record<string, unknown> } | null
  activeProject: string
  activeProjectName: string
  projects: Project[]
  history: SessionSummary[]
}

export type Action =
  | { type: 'INPUT'; payload: string }
  | { type: 'USER_MSG'; payload: string }
  | { type: 'SERVER_MSG'; payload: any }
  | { type: 'TOGGLE_PALETTE' }
  | { type: 'TOGGLE_TWEAKS' }
  | { type: 'SET_TAB'; payload: number }
  | { type: 'TOGGLE_FOCUS' }
  | { type: 'CLEAR' }
  | { type: 'RESOLVE_APPROVAL' }
  | { type: 'SET_THEME'; theme: string; palette: string; density: string }
  | { type: 'INPUT_REQUEST'; payload: { id: string; prompt: string; kind: InputRequestKind; options?: string[] } }
  | { type: 'RESOLVE_INPUT_REQUEST' }
  | { type: 'SET_TODOS'; payload: TodoItem[] }
  | { type: 'RESOLVE_CODE_EXECUTION' }
  | { type: 'SET_ACTIVE_PROJECT'; id: string; name: string }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'SET_HISTORY'; payload: SessionSummary[] }

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INPUT': return { ...state, input: action.payload }
    case 'USER_MSG':
      return {
        ...state,
        input: '',
        busy: true,
        messages: [...state.messages, { id: Math.random().toString(), role: 'user', content: action.payload }]
      }
    case 'TOGGLE_PALETTE': return { ...state, paletteOpen: !state.paletteOpen }
    case 'TOGGLE_TWEAKS': return { ...state, tweaksOpen: !state.tweaksOpen }
    case 'SET_TAB': return { ...state, activeTab: action.payload }
    case 'TOGGLE_FOCUS': return { ...state, focusPane: state.focusPane === 'conv' ? 'work' : 'conv' }
    case 'CLEAR': return { ...state, messages: [], tabs: [], busy: false, pendingApproval: null }
    case 'RESOLVE_APPROVAL': return { ...state, pendingApproval: null }
    case 'SET_THEME': return { ...state, theme: action.theme, palette: action.palette, density: action.density }
    case 'INPUT_REQUEST': return { ...state, pendingInputRequest: action.payload }
    case 'RESOLVE_INPUT_REQUEST': return { ...state, pendingInputRequest: null }
    case 'SET_TODOS': return { ...state, todos: action.payload }
    case 'RESOLVE_CODE_EXECUTION': return { ...state, pendingCodeExecution: null }
    case 'SET_ACTIVE_PROJECT': return { ...state, activeProject: action.id, activeProjectName: action.name }
    case 'SET_PROJECTS': return { ...state, projects: action.payload }
    case 'SET_HISTORY': return { ...state, history: action.payload }
    case 'SERVER_MSG': {
      const msg = action.payload
      if (msg.type === 'token') {
        const last = state.messages[state.messages.length - 1]
        if (last && last.role === 'agent') {
          return { ...state, messages: [...state.messages.slice(0, -1), { ...last, content: (last.content || '') + msg.content }] }
        } else {
          return { ...state, messages: [...state.messages, { id: Math.random().toString(), role: 'agent', content: msg.content }] }
        }
      }
      if (msg.type === 'tool_start') {
        return { ...state, messages: [...state.messages, { id: Math.random().toString(), role: 'tool-call', name: msg.name, input: msg.input, status: 'running' }] }
      }
      if (msg.type === 'tool_end') {
        const m = [...state.messages]
        const idx = m.findLastIndex(x => x.role === 'tool-call' && x.name === msg.name && x.status === 'running')
        if (idx >= 0) m[idx] = { ...m[idx], status: 'done', result: msg.result }
        return { ...state, messages: m }
      }
      if (msg.type === 'tool_prompt') {
        return { ...state, pendingApproval: { id: msg.id, name: msg.name, input: msg.input } }
      }
      if (msg.type === 'input_request') {
        return { ...state, pendingInputRequest: { id: msg.id, prompt: msg.prompt, kind: msg.kind, options: msg.options } }
      }
      if (msg.type === 'todos') {
        return { ...state, todos: msg.todos }
      }
      if (msg.type === 'session_ready') {
        return { ...state, profile: msg.profile, sessionId: msg.sessionId }
      }
      if (msg.type === 'stats') {
        return { ...state, tokens: { in: msg.tokens_in, out: msg.tokens_out } }
      }
      if (msg.type === 'session_end' || msg.type === 'session_resumed') {
        return { ...state, busy: false }
      }
      if (msg.type === 'error') {
        return {
          ...state,
          busy: false,
          messages: [...state.messages, { id: Math.random().toString(), role: 'agent' as const, content: `⚠ ${msg.message}` }],
        }
      }
      if (msg.type === 'code_execute') {
        return { ...state, pendingCodeExecution: { id: msg.id, code: msg.code, language: msg.language, data: msg.data } }
      }
      if (msg.type === 'artifacts') {
        const newTab = { id: Math.random().toString(), label: 'Artifacts', icon: '✦', artifacts: msg.artifacts }
        return { ...state, tabs: [...state.tabs, newTab], activeTab: state.tabs.length }
      }
      if (msg.type === 'projects') {
        return { ...state, projects: msg.projects }
      }
      if (msg.type === 'project_created') {
        return { ...state, projects: [...state.projects, msg.project], activeProject: msg.project.id, activeProjectName: msg.project.name }
      }
      if (msg.type === 'sessions') {
        return { ...state, history: msg.sessions }
      }
      return state
    }
    default: return state
  }
}

export function HarnessApp() {
  const [state, dispatch] = useReducer(reducer, {
    messages: [], tabs: [], activeTab: 0, input: '', busy: false,
    focusPane: 'conv', paletteOpen: false, tokens: { in: 0, out: 0 },
    pendingApproval: null, tweaksOpen: false, theme: 'dark', palette: 'amber', density: 'regular',
    todos: [], pendingInputRequest: null, pendingCodeExecution: null,
    profile: '…', sessionId: '…',
    activeProject: 'inbox', activeProjectName: 'Inbox', projects: [], history: [],
  })

  // YOLO mode — persisted to localStorage, reconnects WS when toggled
  const [yolo, setYolo] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('harness-yolo') === 'true'
  })

  const toggleYolo = () => {
    const next = !yolo
    localStorage.setItem('harness-yolo', String(next))
    setYolo(next)
  }

  const wsUrl = process.env.NEXT_PUBLIC_HARNESS_WS_URL || 'ws://localhost:7337'
  const { send, status, reconnect } = useHarnessWS(
    wsUrl,
    msg => dispatch({ type: 'SERVER_MSG', payload: msg }),
    { yolo }
  )

  // Sync theme state → HTML attribute so CSS tokens apply
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme)
  }, [state.theme])

  // Ref so the stable keydown handler can read current state without re-registering
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') { e.preventDefault(); dispatch({ type: 'TOGGLE_PALETTE' }) }
      if (e.metaKey && e.key === 'l') { e.preventDefault(); dispatch({ type: 'CLEAR' }) }
      if (e.key === 'Escape') {
        // Close whichever panel is open — never open both simultaneously
        if (stateRef.current.paletteOpen) dispatch({ type: 'TOGGLE_PALETTE' })
        else if (stateRef.current.tweaksOpen) dispatch({ type: 'TOGGLE_TWEAKS' })
      }
      if (e.metaKey && e.key === ',') { e.preventDefault(); dispatch({ type: 'TOGGLE_TWEAKS' }) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const workspaceOpen = state.tabs.length > 0

  const handleSend = () => {
    if (!state.input.trim()) return
    dispatch({ type: 'USER_MSG', payload: state.input })
    send({ type: 'message', content: state.input })
  }

  const handleSuggest = (id: string) => {
    const content = `Run the ${id} task.`
    dispatch({ type: 'USER_MSG', payload: content })
    send({ type: 'message', content })
  }

  const handleApprove = () => {
    if (state.pendingApproval) send({ type: 'tool_approve', id: state.pendingApproval.id })
    dispatch({ type: 'RESOLVE_APPROVAL' })
  }

  const handleDeny = () => {
    if (state.pendingApproval) send({ type: 'tool_deny', id: state.pendingApproval.id })
    dispatch({ type: 'RESOLVE_APPROVAL' })
  }

  const handleInputResponse = (id: string, value: string) => {
    send({ type: 'input_response', id, value })
    dispatch({ type: 'RESOLVE_INPUT_REQUEST' })
  }

  const handleCodeResult = (result: ExecutionResult) => {
    send({ type: 'code_result', id: result.id, stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, files: result.files })
    dispatch({ type: 'RESOLVE_CODE_EXECUTION' })
  }

  // Group messages into turns for multi-turn rendering
  type Turn = { type: 'user'; msg: UIMessage } | { type: 'agent'; tools: UIMessage[]; agentMsg?: UIMessage }
  const turns = (() => {
    const result: Turn[] = []
    let cur: { tools: UIMessage[]; agentMsg?: UIMessage } | null = null
    for (const m of state.messages) {
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
    <div className="app">
      <TopBar
        profileName={state.profile}
        sessionId={state.sessionId}
        busy={state.busy}
        onPalette={() => dispatch({ type: 'TOGGLE_PALETTE' })}
      />
      {status !== 'open' && (
        <div style={{ background: 'var(--del)', color: 'var(--bg)', padding: '0.5rem', textAlign: 'center' }}>
          Disconnected ({status}). <button onClick={reconnect}>Reconnect</button>
        </div>
      )}

      <div className={`stage ${workspaceOpen ? 'split' : 'idle'}`}>
        <ConvColumn split={workspaceOpen}>
          {state.messages.length === 0 ? (
            <Hero onSelect={handleSuggest} />
          ) : (
            <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {turns.map((t, i) => t.type === 'user' ? (
                <Message key={t.msg.id} role="user" time={new Date().toLocaleTimeString()}>{t.msg.content}</Message>
              ) : (
                <Message key={`agent-${i}`} role="agent" time={new Date().toLocaleTimeString()}>
                  <AgentTurn message={t.agentMsg || { id: '0', role: 'agent' }} tools={t.tools} />
                </Message>
              ))}
            </div>
          )}
          <Composer
            value={state.input}
            onChange={v => dispatch({ type: 'INPUT', payload: v })}
            onSubmit={handleSend}
            busy={state.busy}
            compact={workspaceOpen}
          />
        </ConvColumn>

        {workspaceOpen && (
          <div className="col-work">
            <Workspace tabs={state.tabs} activeTab={state.activeTab} onTabChange={i => dispatch({ type: 'SET_TAB', payload: i })} />
          </div>
        )}
      </div>

      <StatusBar
        busy={state.busy}
        focusPane={state.focusPane}
        tokens={state.tokens}
        theme={state.theme}
        yolo={yolo}
        onToggleTheme={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark', palette: state.palette, density: state.density })}
        onToggleYolo={toggleYolo}
      />

      {/* Floating task tracker */}
      <TodoPanel todos={state.todos} />

      {state.paletteOpen && (
        <Palette onClose={() => dispatch({ type: 'TOGGLE_PALETTE' })} onRun={handleSuggest} onReset={() => dispatch({ type: 'CLEAR' })} />
      )}
      {state.pendingApproval && (
        <ApprovalModal toolName={state.pendingApproval.name} toolInput={state.pendingApproval.input} onApprove={handleApprove} onDeny={handleDeny} />
      )}
      {state.pendingInputRequest && (
        <InputRequestModal
          id={state.pendingInputRequest.id}
          prompt={state.pendingInputRequest.prompt}
          kind={state.pendingInputRequest.kind}
          options={state.pendingInputRequest.options}
          onSubmit={handleInputResponse}
        />
      )}
      <Tweaks
        open={state.tweaksOpen}
        theme={state.theme} setTheme={theme => dispatch({ type: 'SET_THEME', theme, palette: state.palette, density: state.density })}
        palette={state.palette} setPalette={palette => dispatch({ type: 'SET_THEME', theme: state.theme, palette, density: state.density })}
        density={state.density} setDensity={density => dispatch({ type: 'SET_THEME', theme: state.theme, palette: state.palette, density })}
      />
      <HarnessPython
        pendingExecution={state.pendingCodeExecution}
        allowedPackages={[]}
        onResult={handleCodeResult}
      />
    </div>
  )
}
