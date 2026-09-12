'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ServerMessage } from '../../lib/types'
import { useHarnessWS } from '../../hooks/useHarnessWS'
import { initialOperatorState, operatorReducer, type OperatorState, type OperatorAction } from '../../lib/operatorState'

interface SocketContextValue {
  status: string
  operator: OperatorState
  dispatchOperator: (action: OperatorAction) => void
  events: ServerMessage[]
  send: ReturnType<typeof useHarnessWS>['send']
  reconnect: ReturnType<typeof useHarnessWS>['reconnect']
  userId: string
  setUserId: (userId: string) => void
  subscribe: (listener: (message: ServerMessage) => void) => () => void
}
const SocketContext = createContext<SocketContextValue | null>(null)
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [operator, dispatchOperator] = useReducer(operatorReducer, undefined, initialOperatorState)
  const sessionRef = useRef<string>()
  const [events, setEvents] = useState<ServerMessage[]>([])
  const [userId, setUserIdState] = useState(() => typeof window === 'undefined' ? 'web-user' : localStorage.getItem('harness-user-id') || 'web-user')
  const listeners = useRef(new Set<(message: ServerMessage) => void>())
  const url = process.env.NEXT_PUBLIC_HARNESS_WS_URL || 'ws://localhost:7337'
  const connection = useHarnessWS(url, message => {
    const sessionId = message.type === 'session_ready' || message.type === 'session_resumed' ? message.sessionId : undefined
    const newSession = sessionId !== undefined && sessionRef.current !== sessionId
    if (sessionId) sessionRef.current = sessionId
    dispatchOperator({ type: 'message', payload: message })
    setEvents(current => [...(newSession ? [] : current.slice(-199)), message])
    listeners.current.forEach(listener => listener(message))
    if (message.type === 'skill_result') connection.send({ type: 'skills_list' })
  }, { userId })
  const setUserId = useCallback((next: string) => {
    const normalized = next.trim() || 'web-user'
    if (normalized === userId) return
    sessionRef.current = undefined
    setEvents([])
    dispatchOperator({ type: 'reset' })
    setUserIdState(normalized)
    if (typeof window !== 'undefined') localStorage.setItem('harness-user-id', normalized)
  }, [userId])
  const subscribe = useCallback((listener: (message: ServerMessage) => void) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])
  useEffect(() => {
    if (connection.status !== 'open') dispatchOperator({ type: 'disconnected' })
  }, [connection.status])
  useEffect(() => {
    if (connection.status !== 'open' || !operator.sessionId) return
    connection.send({ type: 'skills_list' })
    connection.send({ type: 'undo_list' })
    connection.send({ type: 'pending_list' })
    connection.send({ type: 'runtime_subscribe', session_id: operator.sessionId, request_id: crypto.randomUUID() })
  }, [connection.status, connection.send, operator.sessionId, operator.profile])
  useEffect(() => {
    const timers = [
      ...Object.values(operator.approvals).filter(item => item.requestId).map(item => setTimeout(() => dispatchOperator({ type: 'decision_failed', id: item.id, requestId: item.requestId!, error: 'Confirmation timed out; refresh server state before retrying.' }), Math.max(0, 30_000 - (Date.now() - (item.sentAt ?? Date.now()))))),
      ...Object.entries(operator.answers).filter(([, item]) => item.requestId).map(([id, item]) => setTimeout(() => dispatchOperator({ type: 'answer_failed', id, requestId: item.requestId!, error: 'Confirmation timed out; refreshing recorded answers.' }), Math.max(0, 30_000 - (Date.now() - (item.sentAt ?? Date.now()))))),
    ]
    return () => timers.forEach(clearTimeout)
  }, [operator.approvals, operator.answers])
  const value = useMemo(() => ({ status: connection.status, operator, dispatchOperator, events, send: connection.send, reconnect: connection.reconnect, userId, setUserId, subscribe }), [connection.reconnect, connection.send, connection.status, operator, events, setUserId, subscribe, userId])
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}
export function useSharedHarnessWS(): SocketContextValue { const value = useContext(SocketContext); if (!value) throw new Error('SocketProvider missing'); return value }
