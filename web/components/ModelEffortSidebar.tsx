'use client'
import { useState } from 'react'
import type { ModelInfo } from '../lib/protocol'

interface Props {
  models?: ModelInfo[]
  currentModel?: string
  currentEffort?: string | null
  effortEnabled?: boolean
  onSelect: (model: string, effort: string | null) => void
}

export function ModelEffortSidebar({ models = [], currentModel, currentEffort = null, effortEnabled = false, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false)
  const availableModels = models.filter(model => model.available)
  const selectedModel = availableModels.find(model => model.id === currentModel)
  const capability = selectedModel?.effort
  const effortSelectable = effortEnabled && capability?.status === 'supported' && !capability.stale
  const modelValue = selectedModel?.id ?? ''
  const effortValue = currentEffort ?? ''
  const effortLabel = currentEffort
    ? capability?.options.find(option => option.value === currentEffort)?.label ?? currentEffort
    : 'Default'

  return (
    <aside className="model-sidebar" aria-label="Model and effort selection">
      <section className="model-sidebar__section">
        <button
          type="button"
          className="model-sidebar__toggle"
          aria-expanded={expanded}
          aria-controls="model-effort-controls"
          onClick={() => setExpanded(open => !open)}
        >
          <span>
            <span className="eyebrow">RUNTIME</span>
            <strong>Model / effort</strong>
          </span>
          <span className="model-sidebar__summary">{currentModel ? `${currentModel} · ${effortLabel}` : 'Waiting for catalog'}</span>
          <span className="model-sidebar__chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>

        {expanded ? (
          <div id="model-effort-controls" className="model-sidebar__controls">
            <label className="model-sidebar__field">
              <span>Model</span>
              <select
                aria-label="Model"
                value={modelValue}
                disabled={availableModels.length === 0}
                onChange={event => { if (event.target.value) onSelect(event.target.value, null) }}
              >
                {!modelValue ? <option value="">{currentModel ?? 'Select a model'}</option> : null}
                {availableModels.map(model => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
              </select>
            </label>

            <label className="model-sidebar__field">
              <span>Effort</span>
              <select
                aria-label="Effort"
                value={effortValue}
                disabled={!effortSelectable || !currentModel}
                onChange={event => onSelect(currentModel!, event.target.value || null)}
              >
                <option value="">Default{capability?.provider_default ? ` · ${capability.provider_default}` : ''}</option>
                {(capability?.options ?? []).map(option => <option key={option.value} value={option.value} disabled={!option.selectable}>{option.label}{option.selectable ? '' : ' · unavailable'}</option>)}
              </select>
            </label>

            {!effortEnabled ? <p className="model-sidebar__hint">Effort selection unavailable for this provider.</p>
              : !capability ? <p className="model-sidebar__hint">Effort support unknown; provider default used.</p>
              : capability.status === 'unknown' ? <p className="model-sidebar__hint">Effort support unknown; provider default used.</p>
              : capability.status === 'unsupported' ? <p className="model-sidebar__hint">Effort unavailable for this model.</p>
              : capability.stale ? <p className="model-sidebar__hint">Catalog is stale; refresh before changing effort.</p>
              : <p className="model-sidebar__hint">Changes apply after server acknowledgement.</p>}
          </div>
        ) : null}
      </section>
    </aside>
  )
}
