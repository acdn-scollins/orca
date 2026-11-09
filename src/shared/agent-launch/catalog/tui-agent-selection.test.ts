import { describe, expect, it } from 'vitest'
import {
  filterEnabledTuiAgents,
  isTuiAgentEnabled,
  normalizeDisabledTuiAgents,
  pickTuiAgent
} from './tui-agent-selection'

describe('pickTuiAgent', () => {
  it('excludes OpenClaw from explicit and detected choices while preserving OpenClaude', () => {
    expect(pickTuiAgent('openclaw', ['openclaw', 'codex'])).toBe('codex')
    expect(pickTuiAgent('openclaw', ['openclaw'])).toBeNull()
    expect(isTuiAgentEnabled('openclaw')).toBe(false)
    expect(filterEnabledTuiAgents(['openclaw', 'openclaude', 'codex'])).toEqual([
      'openclaude',
      'codex'
    ])
  })

  it('respects the explicit blank terminal preference', () => {
    expect(pickTuiAgent('blank', ['cursor', 'claude'])).toBeNull()
  })

  it('ignores disabled preferred and fallback agents', () => {
    expect(pickTuiAgent('codex', ['claude', 'codex'], ['codex'])).toBe('claude')
    expect(pickTuiAgent(null, ['claude', 'codex'], ['claude', 'codex'])).toBeNull()
  })
})

describe('normalizeDisabledTuiAgents', () => {
  it('dedupes supported agent ids and drops unsupported values', () => {
    expect(normalizeDisabledTuiAgents(['codex', 'unknown', 'codex', null, 'claude'])).toEqual([
      'codex',
      'claude'
    ])
  })
})
