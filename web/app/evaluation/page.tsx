'use client'
import { Shell } from '../../components/chrome/Shell'
import { EvaluationPanel } from '../../components/evaluation/EvaluationPanel'
export default function EvaluationPage() { const baseUrl = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'; return <Shell><main className="route-page"><EvaluationPanel baseUrl={baseUrl} /></main></Shell> }
