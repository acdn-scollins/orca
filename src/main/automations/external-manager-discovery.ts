import type {
  ExternalAutomationManager,
  ExternalAutomationProvider
} from '../../shared/automations-types'

export async function listLocalManager(
  _provider: ExternalAutomationProvider
): Promise<ExternalAutomationManager | null> {
  return null
}
