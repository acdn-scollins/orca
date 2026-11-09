import { expect, it } from 'vitest'
import {
  isRecognizedAgentType,
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine
} from './agent-process-recognition'

it('does not recognize OpenClaw as an active agent', () => {
  expect(recognizeAgentProcess('openclaw')).toBeNull()
  expect(recognizeAgentProcessFromCommandLine('node /opt/openclaw/dist/index.js')).toBeNull()
  expect(isRecognizedAgentType('openclaw')).toBe(false)
  expect(recognizeAgentProcess('codex')).toEqual({ agent: 'codex', processName: 'codex' })
})
