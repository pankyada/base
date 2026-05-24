export const theme = {
  bg:        '#1c1c1c',
  text:      '#d4d4d4',
  dim:       '#666666',
  accent:    '#569cd6',   // blue — tool calls, active profile
  success:   '#4ec9b0',   // teal — completed tools, ok status
  warn:      '#dcdcaa',   // yellow — tool approval prompts
  error:     '#f44747',   // red — errors, failed tools
  border:    '#333333',
  inputBg:   '#252526',
  newMemory: '#4ec9b0',   // teal — newly written memory keys
} as const

export type Theme = typeof theme
