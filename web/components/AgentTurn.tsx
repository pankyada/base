import { Thinking } from './Thinking.js'
import { ToolCall } from './ToolCall.js'
import { UIMessage } from '../lib/types.js'

interface Props {
  message: UIMessage
  tools: UIMessage[]
}

export function AgentTurn({ message, tools }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {tools.length > 0 && (
        <Thinking
          steps={tools.map(t => `Running ${t.name}`)}
          active={tools.findIndex(t => t.status === 'running')}
          done={tools.every(t => t.status === 'done')}
        />
      )}
      {tools.map(t => (
        <ToolCall
          key={t.id}
          tool={{ type: t.name || '', arg: JSON.stringify(t.input || {}), out: t.result || '', done: t.status === 'done' }}
          running={t.status === 'running'}
        />
      ))}
      {message.content && <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>}
    </div>
  )
}
