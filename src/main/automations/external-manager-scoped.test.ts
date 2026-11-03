import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScopedExternalAutomations } from './external-manager'
import { ExternalAutomationManagerCache } from './external-automation-manager-cache'
import { ExternalAutomationProbeScheduler } from './external-automation-probe-scheduler'
import type { AutomationOwnerRef } from '../../shared/automation-owner-ref'
import { EXTERNAL_AUTOMATION_SCOPE_CODES } from '../../shared/external-automation-scope'
import type { SshTarget } from '../../shared/ssh-types'
import type * as Fs from 'node:fs'
import type * as FsPromises from 'node:fs/promises'

const runProcessMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())

vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  existsSync: existsSyncMock
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  readFile: readFileMock
}))

const owners: { label: string; owner: AutomationOwnerRef }[] = [
  { label: 'local', owner: { authority: { kind: 'desktop' }, selector: { kind: 'self' } } },
  {
    label: 'SSH',
    owner: {
      authority: { kind: 'desktop' },
      selector: { kind: 'ssh', targetId: 'target-a', targetGeneration: 3 }
    }
  },
  {
    label: 'runtime',
    owner: {
      authority: { kind: 'runtime', environmentId: 'env-1', pairingRevision: 2 },
      selector: { kind: 'self' }
    }
  }
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scoped external automations', () => {
  it.each(owners)(
    'rejects retired OpenClaw requests for $label before any probe',
    async ({ owner }) => {
      const readRegistrations = vi.fn<() => SshTarget[]>(() => [])
      const scheduler = new ExternalAutomationProbeScheduler()
      const schedule = vi.spyOn(scheduler, 'schedule')
      const cache = new ExternalAutomationManagerCache()
      const cacheRead = vi.spyOn(cache, 'resolve')
      const engine = createScopedExternalAutomations({
        registry: { getSshTargets: readRegistrations },
        scheduler,
        cache
      })

      await expect(engine.listManager({ owner, provider: 'openclaw' })).rejects.toThrow(
        EXTERNAL_AUTOMATION_SCOPE_CODES.providerNotAllowed
      )
      await expect(
        engine.runAction({ owner, provider: 'openclaw', jobId: 'job-1', action: 'run' })
      ).rejects.toThrow(EXTERNAL_AUTOMATION_SCOPE_CODES.providerNotAllowed)
      expect(cacheRead).not.toHaveBeenCalled()
      expect(schedule).not.toHaveBeenCalled()
      expect(readRegistrations).not.toHaveBeenCalled()
      expect(existsSyncMock).not.toHaveBeenCalled()
      expect(readFileMock).not.toHaveBeenCalled()
      expect(runProcessMock).not.toHaveBeenCalled()
    }
  )
})
