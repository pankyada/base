import { registerTool } from '../registry.js'
import { readTool } from './read.js'
import { writeTool } from './write.js'
import { editTool } from './edit.js'
import { bashTool } from './bash.js'
import { grepTool } from './grep.js'
import { globTool } from './glob.js'
import { skillTool } from './skill.js'
import { memoryReadTool } from './memory-read.js'
import { memoryWriteTool } from './memory-write.js'
import { memoryListTool } from './memory-list.js'
import { memoryDeleteTool } from './memory-delete.js'
import { memoryLinkedTool } from './memory-linked.js'
import { statsTool } from './stats.js'
import { delegateTool } from './delegate.js'
import { askUserTool } from './ask-user.js'
import { todoWriteTool } from './todo-write.js'
import { todoReadTool } from './todo-read.js'
import { executeCodeTool } from './execute-code.js'

export { clearRegistry, registerTool } from '../registry.js'

export function registerAll(): void {
  registerTool(readTool)
  registerTool(writeTool)
  registerTool(editTool)
  registerTool(bashTool)
  registerTool(grepTool)
  registerTool(globTool)
  registerTool(skillTool)
  registerTool(memoryReadTool)
  registerTool(memoryWriteTool)
  registerTool(memoryListTool)
  registerTool(memoryDeleteTool)
  registerTool(memoryLinkedTool)
  registerTool(statsTool)
  registerTool(delegateTool)
  registerTool(askUserTool)
  registerTool(todoWriteTool)
  registerTool(todoReadTool)
  registerTool(executeCodeTool)
}
