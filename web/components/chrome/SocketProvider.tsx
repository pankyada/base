'use client'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ServerMessage } from '../../lib/types'
import { useHarnessWS } from '../../hooks/useHarnessWS'

interface SocketContextValue {
  status: string
  events: ServerMessage[]
  send: ReturnType<typeof useHarnessWS>['send']
  reconnect: ReturnType<typeof useHarnessWS>['reconnect']
  userId: string
  setUserId: (userId: string) => void
  subscribe: (listener: (message: ServerMessage) => void) => () => void
}
const SocketContext = createContext<SocketContextValue | null>(null)
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ServerMessage[]>([])
  const [userId, setUserIdState] = useState(() => typeof window === 'undefined' ? 'web-user' : localStorage.getItem('harness-user-id') || 'web-user')
  const listeners = useRef(new Set<(message: ServerMessage) => void>())
  const url = process.env.NEXT_PUBLIC_HARNESS_WS_URL || 'ws://localhost:7337'
  const connection = useHarnessWS(url, message => {
    setEvents(current => [...current.slice(-199), message])
    listeners.current.forEach(listener => listener(message))
  }, { userId })
  const setUserId = useCallback((next: string) => {
    const normalized = next.trim() || 'web-user'
    setUserIdState(normalized)
    if (typeof window !== 'undefined') localStorage.setItem('harness-user-id', normalized)
  }, [])
  const subscribe = useCallback((listener: (message: ServerMessage) => void) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])
  const value = useMemo(() => ({ status: connection.status, events, send: connection.send, reconnect: connection.reconnect, userId, setUserId, subscribe }), [connection.reconnect, connection.send, connection.status, events, setUserId, subscribe, userId])
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}
export function useSharedHarnessWS(): SocketContextValue { const value = useContext(SocketContext); if (!value) throw new Error('SocketProvider missing'); return value }
