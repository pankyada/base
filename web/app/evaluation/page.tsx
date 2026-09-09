'use client'
import { Shell } from '../../components/chrome/Shell'
import { EvaluationPanel } from '../../components/evaluation/EvaluationPanel'
import { useSharedHarnessWS } from '../../components/chrome/SocketProvider'
export default function EvaluationPage() { const baseUrl = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'; const { userId } = useSharedHarnessWS(); return <Shell><main className="route-page"><EvaluationPanel baseUrl={baseUrl} scope={{ userId }} /></main></Shell> }
