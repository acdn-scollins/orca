import type {
  ExternalAutomationManager,
  ExternalAutomationProvider
} from '../../shared/automations/external/external-automation'

export async function listLocalManager(
  _provider: ExternalAutomationProvider
): Promise<ExternalAutomationManager | null> {
  return null
}
