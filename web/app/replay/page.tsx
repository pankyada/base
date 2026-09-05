'use client'
import { Shell } from '../../components/chrome/Shell'
import { ReplayPanel } from '../../components/replay/ReplayPanel'
export default function ReplayPage() { const baseUrl = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'; return <Shell><main className="route-page"><ReplayPanel baseUrl={baseUrl} /></main></Shell> }
