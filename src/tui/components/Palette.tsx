import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { C } from '../theme.js'
import { PaletteMode, ROOT_COMMANDS, popMode } from '../palette-modes.js'
import type { Project } from '../../projects/types.js'
import type { SessionSummary } from '../../session/types.js'

interface Props {
  onClose: () => void
  onRun: (id: string) => void
  onReset: () => void
  activeProject: string
  projects: Project[]
  history: SessionSummary[]
  onRequestProjects: () => void
  onRequestHistory: (projectId: string) => void
  onSwitchProject: (id: string, name: string) => void
  onNewProject: (name: string) => void
  onResume: (sessionId: string, project: string) => void
  onAssign: (projectId: string) => void
}

const RUN_SCENARIOS = [
  { id: 'data', title: 'Run Data Analysis' },
  { id: 'coding', title: 'Run Coding Task' },
  { id: 'writing', title: 'Run Writing Task' },
  { id: 'research', title: 'Run Research Task' }
]

const SESSION_ACTIONS = [
  { id: 'reset', title: 'Clear Session' }
]

export function Palette({
  onClose, onRun, onReset,
  activeProject, projects, history,
  onRequestProjects, onRequestHistory,
  onSwitchProject, onNewProject, onResume, onAssign
}: Props) {
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>('root')
  const [newProjName, setNewProjName] = useState('')

  // Request data when entering a data mode
  useEffect(() => {
    if (mode === 'project_switch' || mode === 'assign') {
      onRequestProjects()
    } else if (mode === 'history') {
      onRequestHistory(activeProject)
    } else if (mode === 'history_all') {
      onRequestHistory('')
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset selection when mode or filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [mode, filter])

  // Build items based on current mode
  const items: { id: string; title: string; group: string; subtitle?: string }[] = (() => {
    const q = filter.toLowerCase()
    if (mode === 'root') {
      const run = RUN_SCENARIOS
        .filter(s => s.title.toLowerCase().includes(q))
        .map(s => ({ ...s, group: 'RUN TASK' }))
      const sess = SESSION_ACTIONS
        .filter(s => s.title.toLowerCase().includes(q))
        .map(s => ({ ...s, group: 'SESSION' }))
      const root = ROOT_COMMANDS
        .filter(c => c.label.toLowerCase().includes(q))
        .map(c => ({ id: c.id, title: c.label, group: c.group }))
      return [...run, ...sess, ...root]
    }
    if (mode === 'project_switch' || mode === 'assign') {
      return projects
        .filter(p => p.name.toLowerCase().includes(q))
        .map(p => ({ id: p.id, title: p.name, group: 'PROJECT' }))
    }
    if (mode === 'history' || mode === 'history_all') {
      return history
        .filter(h => (h.title ?? h.id).toLowerCase().includes(q))
        .map(h => ({ id: h.id, title: h.title ?? h.id.slice(0, 8), group: 'HISTORY', subtitle: h.summary }))
    }
    return []
  })()

  useInput((_input, key) => {
    if (mode === 'project_new') {
      // TextInput handles typing; only intercept enter/escape
      if (key.escape) {
        const result = popMode(mode)
        if (result.close) onClose()
        else { setMode(result.mode); setNewProjName(''); setFilter('') }
      }
      if (key.return && newProjName.trim()) {
        onNewProject(newProjName.trim())
        onClose()
      }
      return
    }

    if (key.escape) {
      const result = popMode(mode)
      if (result.close) onClose()
      else { setMode(result.mode); setFilter('') }
      return
    }
    if (key.downArrow) setSelectedIndex(i => Math.min(i + 1, Math.max(items.length - 1, 0)))
    if (key.upArrow) setSelectedIndex(i => Math.max(i - 1, 0))
    if (key.return && items.length > 0) {
      const item = items[selectedIndex]
      if (mode === 'root') {
        // Check if it's a ROOT_COMMAND
        const rootCmd = ROOT_COMMANDS.find(c => c.id === item.id)
        if (rootCmd) {
          setMode(rootCmd.mode)
          setFilter('')
          return
        }
        if (item.id === 'reset') onReset()
        else onRun(item.id)
        onClose()
      } else if (mode === 'project_switch') {
        const p = projects.find(x => x.id === item.id)
        if (p) onSwitchProject(p.id, p.name)
        onClose()
      } else if (mode === 'assign') {
        onAssign(item.id)
        onClose()
      } else if (mode === 'history' || mode === 'history_all') {
        const h = history.find(x => x.id === item.id)
        if (h) onResume(h.id, h.project)
        onClose()
      }
    }
  })

  const modeLabel: Record<PaletteMode, string> = {
    root: 'Search commands…',
    project_switch: 'Switch to project…',
    project_new: 'New project name…',
    history: 'Browse session history…',
    history_all: 'Browse all sessions…',
    assign: 'Move session to project…',
  }

  return (
    <Box position="absolute" width="100%" height="100%" justifyContent="center" alignItems="center">
      <Box width={60} flexDirection="column" borderStyle="single" borderColor={C.border} backgroundColor={C.panel}>
        <Box padding={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottomColor={C.border}>
          {mode === 'project_new' ? (
            <TextInput
              value={newProjName}
              onChange={setNewProjName}
              placeholder="Enter project name…"
            />
          ) : (
            <TextInput
              value={filter}
              onChange={setFilter}
              placeholder={modeLabel[mode]}
            />
          )}
        </Box>
        {mode !== 'project_new' && (
          <Box flexDirection="column" paddingY={1}>
            {items.length === 0 && (
              <Box paddingX={1}>
                <Text color={C.dim}>No results</Text>
              </Box>
            )}
            {items.map((item, i) => (
              <Box key={item.id} paddingX={1} backgroundColor={selectedIndex === i ? C.accent : undefined}>
                <Box width={15}>
                  <Text color={selectedIndex === i ? C.bgDeep : C.dim} dimColor={selectedIndex !== i}>{item.group}</Text>
                </Box>
                <Box flexDirection="column">
                  <Text color={selectedIndex === i ? C.bgDeep : C.text}>{item.title}</Text>
                  {item.subtitle && (
                    <Text color={selectedIndex === i ? C.bgDeep : C.dim} dimColor>{item.subtitle.slice(0, 38)}</Text>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {mode !== 'root' && (
          <Box paddingX={1} paddingBottom={1}>
            <Text color={C.dim}>[Esc] back to root</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
