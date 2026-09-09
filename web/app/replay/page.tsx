'use client'
import { Shell } from '../../components/chrome/Shell'
import { ReplayPanel } from '../../components/replay/ReplayPanel'
import { useSharedHarnessWS } from '../../components/chrome/SocketProvider'
export default function ReplayPage() { const baseUrl = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'; const { userId } = useSharedHarnessWS(); return <Shell><main className="route-page"><ReplayPanel baseUrl={baseUrl} scope={{ userId }} /></main></Shell> }
