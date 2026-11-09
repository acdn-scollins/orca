import { expect, it } from 'vitest'
import { createScopedExternalAutomations } from './external-manager'
import { ExternalAutomationManagerCache } from './external-automation-manager-cache'
import { ExternalAutomationProbeScheduler } from './external-automation-probe-scheduler'

it('refuses retired OpenClaw discovery and commands before resolving the SSH host', async () => {
  const engine = createScopedExternalAutomations({
    registry: {
      getSshTargets: () => {
        throw new Error('Retired providers must not resolve SSH hosts')
      }
    },
    scheduler: new ExternalAutomationProbeScheduler(),
    cache: new ExternalAutomationManagerCache()
  })
  const request = {
    owner: {
      authority: { kind: 'desktop' as const },
      selector: { kind: 'ssh' as const, targetId: 'target-a', targetGeneration: 3 }
    },
    provider: 'openclaw' as const
  }

  await expect(engine.listManager(request)).rejects.toMatchObject({
    code: 'external_automation_provider_not_allowed'
  })
  await expect(
    engine.runAction({ ...request, jobId: 'job-1', action: 'run' })
  ).rejects.toMatchObject({ code: 'external_automation_provider_not_allowed' })
})
