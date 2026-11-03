import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runExternalAutomationAction } from './external-manager'
import { listLocalManager } from './external-manager-discovery'
import { mapOpenClawJobs } from './external-job-mappers'
import { EXTERNAL_AUTOMATION_SCOPE_CODES } from '../../shared/external-automation-scope'
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('retired external automation integration', () => {
  it('does not discover local jobs or look for a provider executable', async () => {
    await expect(listLocalManager('openclaw')).resolves.toBeNull()
    expect(existsSyncMock).not.toHaveBeenCalled()
    expect(readFileMock).not.toHaveBeenCalled()
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('still rejects job IDs that could be parsed as CLI options', async () => {
    await expect(
      runExternalAutomationAction({
        managerId: 'openclaw:local',
        provider: 'openclaw',
        target: { type: 'local' },
        jobId: '-help',
        action: 'run'
      })
    ).rejects.toThrow('Invalid external automation job ID.')
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it.each(['pause', 'resume', 'run', 'delete'] as const)(
    'rejects a saved %s action on local and SSH hosts without launching a process',
    async (action) => {
      for (const target of [
        { type: 'local' } as const,
        { type: 'ssh', connectionId: 'ssh-1' } as const
      ]) {
        await expect(
          runExternalAutomationAction({
            managerId: 'openclaw:local',
            provider: 'openclaw',
            target,
            jobId: 'job-1',
            action
          })
        ).rejects.toThrow(EXTERNAL_AUTOMATION_SCOPE_CODES.providerNotAllowed)
      }
      expect(runProcessMock).not.toHaveBeenCalled()
    }
  )
})

describe('mapOpenClawJobs', () => {
  it('normalizes OpenClaw cron jobs into external automation rows', () => {
    const jobs = mapOpenClawJobs('openclaw:local', {
      version: 1,
      jobs: [
        {
          id: 'claw-1',
          name: 'Morning report',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/Phoenix' },
          payload: { kind: 'agentTurn', message: 'Summarize overnight alerts' },
          state: {
            nextRunAtMs: Date.parse('2026-05-16T16:00:00Z'),
            lastRunAtMs: Date.parse('2026-05-15T16:00:00Z'),
            lastRunStatus: 'ok'
          }
        }
      ]
    })

    expect(jobs[0]).toMatchObject({
      id: 'claw-1',
      managerId: 'openclaw:local',
      provider: 'openclaw',
      name: 'Morning report',
      schedule: 'cron 0 9 * * * @ America/Phoenix',
      rawSchedule: '0 9 * * *',
      enabled: true,
      state: 'ok',
      prompt: 'Summarize overnight alerts',
      promptPreview: 'Summarize overnight alerts',
      nextRunAt: '2026-05-16T16:00:00.000Z',
      lastRunAt: '2026-05-15T16:00:00.000Z',
      lastStatus: 'ok'
    })
  })
})
