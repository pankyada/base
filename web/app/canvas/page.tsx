'use client'
import { useEffect, useState } from 'react'
import { Shell } from '../../components/chrome/Shell'
import { Canvas } from '../../components/data/Canvas'
import type { CanvasArtifact, PinnedArtifact } from '../../lib/canvas'

const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'

function canvasRecipe(recipe: any): PinnedArtifact {
  const provenance = recipe.provenance?.session_id && recipe.provenance?.tool_call_id
    ? { session: recipe.provenance.session_id, toolCall: recipe.provenance.tool_call_id, code: recipe.code_ref, source: recipe.provenance.source }
    : { session: '', toolCall: '' }
  const payload = recipe.last_good?.payload
  const artifact: CanvasArtifact = {
    id: recipe.id,
    kind: recipe.parameters?.kind ?? 'doc',
    title: recipe.parameters?.title ?? `Artifact ${recipe.id}`,
    data: payload,
    recipeId: recipe.id,
    version: recipe.last_good?.version,
    freshness: recipe.freshness,
    sourceCursor: recipe.last_good?.source_cursor,
    generatingTool: recipe.generating_tool,
  }
  return { artifact, provenance }
}

export default function CanvasPage() {
  const [recipes, setRecipes] = useState<any[]>([])
  const [error, setError] = useState<string>()
  const [user, setUser] = useState('anonymous')
  useEffect(() => {
    const scopedUser = new URLSearchParams(window.location.search).get('user') ?? 'anonymous'
    setUser(scopedUser)
    void fetch(`${base}/artifacts?user=${encodeURIComponent(scopedUser)}`).then(response => response.ok ? response.json() : Promise.reject(new Error(`artifact request failed (${response.status})`))).then(body => setRecipes(body.recipes ?? [])).catch(cause => setError(cause instanceof Error ? cause.message : 'artifact request failed'))
  }, [])
  const refresh = async (artifact: CanvasArtifact): Promise<CanvasArtifact> => {
    const response = await fetch(`${base}/artifacts/${encodeURIComponent(artifact.recipeId ?? artifact.id)}/refresh?user=${encodeURIComponent(user)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
    if (!response.ok) throw new Error(`refresh failed (${response.status})`)
    const body = await response.json() as { recipe?: any }
    if (!body.recipe?.last_good) throw new Error('refresh returned no last-good version')
    return canvasRecipe(body.recipe).artifact
  }
  const available = recipes.map(canvasRecipe)
  return <Shell><main className="route-page"><header><span className="eyebrow">R10 / ARTIFACTS</span><h1>Refreshable Canvas</h1><p>Pin owned recipes, inspect lineage, and refresh persisted versions.</p></header>{error ? <div role="alert">{error}</div> : null}<Canvas projectId="canvas-fixture" available={available} onRefresh={refresh} /></main></Shell>
}
