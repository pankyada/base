'use client'
import { useState, useReducer, useEffect, useRef, useCallback } from 'react'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { ConvColumn } from './ConvColumn'
import { Workspace } from './Workspace'
import { Palette } from './Palette'
import { shouldOfferCompact } from './Palette'
import { Tweaks } from './Tweaks'
import { ApprovalModal } from './ApprovalModal'
import { Hero } from './Hero'
import { Message } from './Message'
import { AgentTurn } from './AgentTurn'
import { Composer } from './Composer'
import type { UIMessage, ExecutionResult, ClientMessage } from '../lib/types'
import { reducer, initialState, type State, type Action } from '../lib/reducer'
export { reducer }
export type { State, Action }
import { HarnessPython } from './HarnessPython'
import { InputRequestModal } from './InputRequestModal'
import { TodoPanel } from './TodoPanel'
import { useHarnessQuery } from '../hooks/useHarnessQuery'
import { NotebookCell } from './data/NotebookCell'
import { Rail } from './chrome/Rail'
import { StageStrip } from './turn/StageStrip'
import { Toasts } from './chrome/Toasts'
import { useSharedHarnessWS } from './chrome/SocketProvider'
import { sendFailureReason } from '../hooks/useHarnessWS'
import { escapeHtml, sessionToHtml } from '../lib/export'

export function HarnessApp() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const wsUrl = process.env.NEXT_PUBLIC_HARNESS_WS_URL || 'ws://localhost:7337'
  const { send, status, reconnect, events, subscribe, userId, setUserId } = useSharedHarnessWS()
  useEffect(() => {
    events.forEach(message => dispatch({ type: 'SERVER_MSG', payload: message }))
    return subscribe(message => dispatch({ type: 'SERVER_MSG', payload: message }))
  // Initial buffered events are replayed once; live events use the subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hydrateTranscript = useCallback((messages: UIMessage[], prepend: boolean) => dispatch({ type: 'HYDRATE_MESSAGES', payload: { messages, prepend } }), [])
  const transcript = useHarnessQuery(wsUrl.replace(/^ws/, 'http'), state.sessionId, hydrateTranscript, { userId, profile: state.profile })

  // Auto-assign new sessions to the active project (skip inbox — that's the default)
  const assignedFor = useRef<string>('')
  useEffect(() => {
    const sid = state.sessionId
    if (sid && sid !== '…' && state.activeProject !== 'inbox' && assignedFor.current !== sid) {
      assignedFor.current = sid
      send({ type: 'project_assign', sessionId: sid, projectId: state.activeProject })
    }
  }, [state.sessionId, state.activeProject, send])

  // Sync theme state → HTML attribute so CSS tokens apply
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme)
  }, [state.theme])

  useEffect(() => {
    if (status === 'open') send({ type: 'profiles_list' })
  }, [status, send])

  useEffect(() => {
    const draft = window.localStorage.getItem('harness-composer-draft')
    if (draft) { dispatch({ type: 'INPUT', payload: draft }); window.localStorage.removeItem('harness-composer-draft') }
  }, [])

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

  const workspaceOpen = state.tabs.length > 0 || (state.surfaces?.length ?? 0) > 0

  // Only treat a message as sent once the transport confirms the write; a
  // refused frame keeps the text in the composer and reports why.
  const handleSend = () => {
    if (!state.input.trim()) return
    const content = state.input
    const result = send({ type: 'message', content })
    if (!result.ok) { dispatch({ type: 'SEND_FAILED', reason: sendFailureReason(result) }); return }
    dispatch({ type: 'USER_MSG', payload: content })
  }

  const handleSuggest = (id: string) => {
    const content = `Run the ${id} task.`
    const result = send({ type: 'message', content })
    if (!result.ok) { dispatch({ type: 'SEND_FAILED', reason: sendFailureReason(result) }); return }
    dispatch({ type: 'USER_MSG', payload: content })
  }

  const sendControl = (msg: ClientMessage) => {
    const result = send(msg)
    if (!result.ok) dispatch({ type: 'SEND_FAILED', reason: sendFailureReason(result) })
    return result
  }

  const handleCancel = () => { if (state.busy) sendControl({ type: 'cancel' }) }
  const handleCompact = () => sendControl({ type: 'compact' })
  const handleSurfaceEmit = (name: string, payload: unknown) => sendControl({ type: 'message', content: '[surface event ' + name + '] ' + JSON.stringify(payload ?? null) })
  const handleExportSession = () => {
    const body = state.messages.map(message => `<article><strong>${escapeHtml(message.role)}</strong><p>${escapeHtml(message.content ?? message.result ?? message.name ?? '')}</p></article>`).join('')
    const html = sessionToHtml(`${state.profile} session`, body)
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${state.sessionId || 'session'}.html`
    anchor.click()
    URL.revokeObjectURL(url)
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
    dispatch({ type: 'RECORD_EXECUTION', payload: { code: state.pendingCodeExecution?.code, result } })
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
        profiles={state.profiles}
        onSetProfile={name => send({ type: 'set_profile', profile: name })}
        projectName={state.activeProjectName}
        sessionId={state.sessionId}
        busy={state.busy}
        model={state.currentModel}
        onPalette={() => dispatch({ type: 'TOGGLE_PALETTE' })}
        onExportSession={handleExportSession}
      />
      {status !== 'open' && (
        <div style={{ background: 'var(--del)', color: 'var(--bg)', padding: '0.5rem', textAlign: 'center' }}>
          Disconnected ({status}). <button onClick={reconnect}>Reconnect</button>
        </div>
      )}

      <div className="app-body">
      <Rail busy={state.busy} profile={state.profile} model={state.currentModel} onPalette={() => dispatch({ type: 'TOGGLE_PALETTE' })} />
      <div className="app-main">
      <StageStrip stages={state.stages} />
      <div className={`stage ${workspaceOpen ? 'split' : 'idle'}`}>
        <ConvColumn split={workspaceOpen}>
          {state.messages.length === 0 ? (
            <Hero onSelect={handleSuggest} />
          ) : (
            <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {transcript.hasEarlier ? <button onClick={transcript.loadEarlier} disabled={transcript.loading}>load earlier</button> : null}
              {turns.map((t, i) => t.type === 'user' ? (
                <Message key={t.msg.id} role="user" time={new Date().toLocaleTimeString()}>{t.msg.content}</Message>
              ) : (
                <Message key={`agent-${i}`} role="agent" time={new Date().toLocaleTimeString()}>
                  <AgentTurn message={t.agentMsg || { id: '0', role: 'agent' }} tools={t.tools} />
                </Message>
              ))}
            </div>
          )}
          {state.executions?.map((execution, index) => <NotebookCell key={`${execution.result.id}-${index}`} result={execution.result} code={execution.code} onRerun={() => execution.code ? send({ type: 'message', content: `Run this code again:\n\n${execution.code}` }) : undefined} onEdit={() => dispatch({ type: 'INPUT', payload: execution.code ?? '' })} />)}
          <Composer
            value={state.input}
            onChange={v => dispatch({ type: 'INPUT', payload: v })}
            onSubmit={handleSend}
            busy={state.busy}
            compact={workspaceOpen}
            onCancel={handleCancel}
            onCompact={handleCompact}
            compactOffer={shouldOfferCompact(state.context?.tokens, state.context?.window)}
            sendError={state.sendError}
          />
        </ConvColumn>

        {workspaceOpen && (
          <div className="col-work">
            <Workspace projectId={state.activeProject} tabs={state.tabs} activeTab={state.activeTab} onTabChange={i => dispatch({ type: 'SET_TAB', payload: i })} surfaces={state.surfaces} allowedPackages={state.allowedPackages ?? []} onSurfaceEmit={handleSurfaceEmit} onSurfaceResult={result => send({ type: 'ui_result', id: result.id, ok: result.ok, errors: result.errors, stdout: result.stdout, duration_ms: result.duration_ms, bytes: result.bytes })} datasetBaseUrl={wsUrl.replace(/^ws/, 'http')} datasetUser={userId} onDatasetContext={context => dispatch({ type: 'INPUT', payload: `${state.input}${state.input ? '\n' : ''}${context}` })} />
          </div>
        )}
      </div>
      </div>
      </div>

      <StatusBar
        busy={state.busy}
        focusPane={state.focusPane}
        tokens={state.tokens}
        theme={state.theme}
        approvalMode={state.approvalMode}
        onToggleTheme={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark', palette: state.palette, density: state.density })}
        context={state.context}
        costUsd={state.costUsd}
        usage={state.usage}
      />

      <Toasts toasts={state.notices} />

      {/* Floating task tracker */}
      <TodoPanel todos={state.todos} />

      {state.paletteOpen && (
        <Palette
          onClose={() => dispatch({ type: 'TOGGLE_PALETTE' })}
          onRun={handleSuggest}
          onReset={() => dispatch({ type: 'CLEAR' })}
          activeProject={state.activeProject}
          projects={state.projects}
          history={state.history}
          onRequestProjects={() => send({ type: 'project_list' })}
          onRequestHistory={(projectId) => send({ type: 'session_list', ...(projectId ? { projectId } : {}) })}
          onSwitchProject={(id, name) => { dispatch({ type: 'SET_ACTIVE_PROJECT', id, name }); send({ type: 'session_list', projectId: id }) }}
          onNewProject={(name) => send({ type: 'project_create', name })}
          onResume={(sessionId, project) => { send({ type: 'resume', sessionId }); const p = state.projects.find(x => x.id === project); dispatch({ type: 'SET_ACTIVE_PROJECT', id: project, name: p?.name ?? 'Inbox' }) }}
          onAssign={(projectId) => { if (state.sessionId && state.sessionId !== '…') send({ type: 'project_assign', sessionId: state.sessionId, projectId }) }}
          models={state.models}
          commands={state.commands}
          onSetModel={model => send({ type: 'set_model', model })}
          profiles={state.profiles}
          onSetProfile={name => send({ type: 'set_profile', profile: name })}
          approvalMode={state.approvalMode}
          onSetApprovalMode={mode => send({ type: 'set_approval_mode', mode })}
        />
      )}
      {state.pendingApproval && (
        <ApprovalModal toolName={state.pendingApproval.name} toolInput={state.pendingApproval.input} risk={state.pendingApproval.risk} reason={state.pendingApproval.reason} preview={state.pendingApproval.preview} onApprove={handleApprove} onDeny={handleDeny} />
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
        userId={userId}
        setUserId={setUserId}
      />
      <HarnessPython
        pendingExecution={state.pendingCodeExecution}
        allowedPackages={state.allowedPackages ?? []}
        onResult={handleCodeResult}
      />
    </div>
  )
}
