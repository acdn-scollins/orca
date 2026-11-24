import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findBotImportSources } from '../../src/main/bots/bot-import-sources.ts'
import { BotCreate } from '../../src/shared/rpc-contract/bots-params.ts'
import { BotImportedFromSchema, botImportKickoff } from '../../src/shared/bots/bot-import.ts'
import { AI_VAULT_AGENT_SOURCES } from '../../src/main/ai-vault/discovery/session-scanner-agent-sources.ts'
import {
  isTuiAgentEnabled,
  pickTuiAgent
} from '../../src/shared/agent-launch/catalog/tui-agent-selection.ts'
import { KNOWN_TUI_AGENT_DETECTION_COMMANDS } from '../../src/shared/agent-launch/catalog/tui-agent-detection-commands.ts'
import { SKILL_INSTALL_PROVIDERS } from '../../src/shared/skills/installation/skill-install-providers.ts'
import { buildAiVaultLocalResumeStartup } from '../../src/shared/ai-vault/resume/ai-vault-resume-startup.ts'

import {
  getProviderFlag,
  getOptionalProviderFlag
} from '../../src/cli/automations/automation-handler-flags.ts'

const home = await mkdtemp(path.join(tmpdir(), 'orca-no-openclaw-'))
try {
  for (const root of ['.openclaw', '.clawdbot', '.moltbot', 'custom-root']) {
    await mkdir(path.join(home, root, 'agents/main'), { recursive: true })
    await mkdir(path.join(home, root, 'workspace'), { recursive: true })
    await writeFile(path.join(home, root, 'workspace/IDENTITY.md'), 'Name: Retired')
  }
  await mkdir(path.join(home, '.hermes'), { recursive: true })
  await writeFile(path.join(home, '.hermes/SOUL.md'), 'Supported bot')
  await mkdir(path.join(home, 'OpenBot/Agents/agent-reviewer'), { recursive: true })
  const sources = await findBotImportSources(
    {
      home,
      platform: 'linux',
      env: { OPENCLAW_STATE_DIR: path.join(home, 'custom-root') }
    },
    []
  )
  assert.deepEqual(
    sources.map((source) => source.app),
    ['hermes', 'openbot']
  )
  const from = { app: 'openclaw', path: path.join(home, '.openclaw/workspace'), name: 'Retired' }
  assert.equal(BotCreate.safeParse({ name: 'Imported bot', importFrom: from }).success, false)
  assert.equal(
    BotCreate.safeParse({ name: 'Imported bot', importFrom: { ...from, app: 'hermes' } }).success,
    true
  )
  const legacy = BotImportedFromSchema.parse(from)
  assert.equal(legacy.app, 'openclaw')
  assert.throws(() => botImportKickoff(legacy, 'Retired'))
  assert.throws(() => getProviderFlag(new Map([['provider', 'openclaw']])))
  assert.throws(() => getOptionalProviderFlag(new Map([['provider', 'openclaw']])))
  assert.equal(getOptionalProviderFlag(new Map()), undefined)
  assert.equal(getOptionalProviderFlag(new Map([['provider', 'codex']])), 'codex')
  assert.equal(isTuiAgentEnabled('openclaw'), false)
  assert.equal(isTuiAgentEnabled('codex'), true)
  assert.equal(isTuiAgentEnabled('openclaude'), true)
  assert.equal(pickTuiAgent('openclaw', ['openclaw', 'codex']), 'codex')
  assert.equal(
    KNOWN_TUI_AGENT_DETECTION_COMMANDS.some((entry) => entry.id === 'openclaw'),
    false
  )
  assert.equal(
    SKILL_INSTALL_PROVIDERS.some((entry) => entry.id === 'openclaw'),
    false
  )
  assert.deepEqual(
    AI_VAULT_AGENT_SOURCES.openclaw.rootDirs({ openclawStateDir: path.join(home, 'custom-root') }, [
      home
    ]),
    []
  )
  assert.throws(() =>
    buildAiVaultLocalResumeStartup({
      session: { agent: 'openclaw', sessionId: 'legacy', cwd: home, codexHome: null },
      host: { platform: 'linux', codexHome: null, liveShell: undefined },
      settings: undefined,
      embedCwd: false
    })
  )
  console.log(
    'OpenClaw removal passed: no discovery/import/launch/resume/skills; other providers and legacy metadata preserved.'
  )
} finally {
  await rm(home, { recursive: true, force: true })
}
