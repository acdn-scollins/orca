import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTERNAL_AUTOMATION_SCOPE_CODES } from '../../shared/external-automation-scope'
import type { AutomationOwnerRef } from '../../shared/automation-owner-ref'
import type { SshTarget } from '../../shared/ssh-types'
import type { AutomationService } from '../automations/service'
import type { Store } from '../persistence'
import type * as Fs from 'node:fs'
import { ExternalAutomationManagerCache } from '../automations/external-automation-manager-cache'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const ipcHandlers = new Map<string, IpcHandler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler)
    }
  }
}))

const probeCommand = vi.hoisted(() => vi.fn())
const fileExists = vi.hoisted(() => vi.fn(() => false))
const readRegistrations = vi.fn(() => state.targets)
vi.mock('@orca/process-host', () => ({ runProcess: probeCommand }))
// Isolate external job reads from the developer's real home.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  existsSync: fileExists
}))
const PROBE_FOUND = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }

function sshTarget(overrides: Partial<SshTarget> = {}): SshTarget {
  return {
    id: 't1',
    label: 'build-box',
    host: 'build.example',
    user: 'orca',
    generation: 3,
    ...overrides
  } as SshTarget
}

const desktopSelf: AutomationOwnerRef = {
  authority: { kind: 'desktop' },
  selector: { kind: 'self' }
}

function desktopSsh(targetId = 't1', targetGeneration = 3): AutomationOwnerRef {
  return {
    authority: { kind: 'desktop' },
    selector: { kind: 'ssh', targetId, targetGeneration }
  }
}

const state: {
  targets: SshTarget[]
  /** The lease registration installs on the service, for the runtime methods to take. */
  service: { externalProbePriority: (<T>(run: () => T) => T) | null }
} = {
  targets: [sshTarget()],
  service: { externalProbePriority: null }
}

/** Async like the real bridge: Electron turns a handler's sync throw into a rejection. */
async function invoke(channel: string, payload?: unknown): Promise<unknown> {
  const handler = ipcHandlers.get(channel)
  if (!handler) {
    throw new Error(`no handler registered for ${channel}`)
  }
  return await handler(null, payload)
}

beforeEach(async () => {
  ipcHandlers.clear()
  probeCommand.mockReset()
  probeCommand.mockResolvedValue(PROBE_FOUND)
  fileExists.mockClear()
  readRegistrations.mockClear()
  state.targets = [sshTarget()]
  state.service = { externalProbePriority: null }
  const { registerAutomationHandlers } = await import('./automations')
  const store = {
    getSshTargets: readRegistrations,
    assertAutomationOwnerFence: () => undefined
  }
  registerAutomationHandlers(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handler registration reads only these store methods.
    store as unknown as Store,
    state.service as unknown as AutomationService
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('scoped external-manager IPC', () => {
  it.each(['openclaw', 'hermes', 'unknown', 'toString'])(
    'rejects %s before cache, filesystem, process, or host work',
    async (provider) => {
      const cacheRead = vi.spyOn(ExternalAutomationManagerCache.prototype, 'resolve')
      const cacheWrite = vi.spyOn(ExternalAutomationManagerCache.prototype, 'invalidateOwner')
      try {
        for (const owner of [desktopSelf, desktopSsh()]) {
          await expect(
            invoke('automations:listExternalManagerForOwner', { owner, provider })
          ).rejects.toThrow(EXTERNAL_AUTOMATION_SCOPE_CODES.providerNotAllowed)
          await expect(
            invoke('automations:runExternalActionForOwner', {
              owner,
              provider,
              jobId: 'job-1',
              action: 'delete'
            })
          ).rejects.toThrow(EXTERNAL_AUTOMATION_SCOPE_CODES.providerNotAllowed)
        }
        expect(cacheRead).not.toHaveBeenCalled()
        expect(cacheWrite).not.toHaveBeenCalled()
        expect(fileExists).not.toHaveBeenCalled()
        expect(probeCommand).not.toHaveBeenCalled()
        expect(readRegistrations).not.toHaveBeenCalled()
      } finally {
        cacheRead.mockRestore()
        cacheWrite.mockRestore()
      }
    }
  )

  it('does not register external create, edit, or history handlers', () => {
    for (const channel of [
      'automations:createExternalForOwner',
      'automations:updateExternalForOwner',
      'automations:listExternalRunsForOwner'
    ]) {
      expect(ipcHandlers.has(channel)).toBe(false)
    }
  })

  it('refuses a request with no captured owner without probing', async () => {
    await expect(
      invoke('automations:listExternalManagerForOwner', { provider: 'openclaw' })
    ).rejects.toThrow(/automation owner is required/i)
    await expect(invoke('automations:runExternalActionForOwner', {})).rejects.toThrow(
      /automation owner is required/i
    )
    expect(probeCommand).not.toHaveBeenCalled()
  })
})
