import { expect, it } from 'vitest'
import { getOptionalProviderFlag, getProviderFlag } from './automation-handler-flags'

it('rejects the retired OpenClaw provider on automation creation and editing', () => {
  const flags = new Map<string, string | boolean>([['provider', 'openclaw']])

  expect(() => getProviderFlag(flags)).toThrowError(
    expect.objectContaining({ code: 'invalid_argument' })
  )
  expect(() => getOptionalProviderFlag(flags)).toThrowError(
    expect.objectContaining({ code: 'invalid_argument' })
  )
})
