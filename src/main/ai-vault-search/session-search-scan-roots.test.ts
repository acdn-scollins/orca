import { expect, it } from 'vitest'
import { delimiter, join } from 'node:path'
import type { SessionFileDiscovery } from '../ai-vault/session-scanner-types'
import { sameSessionSearchRoots, sessionSearchRootListings } from './session-search-scan-roots'
import { devinTranscriptsInHome } from './session-search-merged-source-fixture'

const TRANSCRIPTS = '/tmp/ss-roots/devin-transcripts'
const WSL_HOME = '/tmp/ss-roots/wsl-home'

function file(path: string): SessionFileDiscovery['files'][number] {
  return { path, mtimeMs: 0, modifiedAt: new Date(0).toISOString() }
}

it('attributes a file by path segment, not by string prefix', () => {
  const secondary = devinTranscriptsInHome(WSL_HOME)
  const listings = sessionSearchRootListings(
    { devinTranscriptsDir: TRANSCRIPTS, wslHomeDirs: [WSL_HOME] },
    [
      {
        agent: 'devin',
        rootDir: [TRANSCRIPTS, secondary].join(delimiter),
        files: [file(join(`${TRANSCRIPTS}-old`, 'two.json'))]
      }
    ]
  )

  const byRoot = Object.fromEntries(listings.map((one) => [one.root, one.files]))
  expect(byRoot[TRANSCRIPTS]).toBe(0)
  expect(byRoot[secondary]).toBe(0)
})

it('compares WSL readers structurally without restarting for reordered objects', () => {
  const ubuntu = { distro: 'Ubuntu', executable: '/usr/bin/node', readerPath: '/reader.cjs' }
  const debian = { distro: 'Debian', error: 'Preparing' }
  expect(
    sameSessionSearchRoots(
      { wslOpenCodeReaders: [ubuntu, debian] },
      {
        wslOpenCodeReaders: [
          { error: 'Preparing', distro: 'debian' },
          { readerPath: '/reader.cjs', executable: '/usr/bin/node', distro: 'ubuntu' }
        ]
      }
    )
  ).toBe(true)
  expect(sameSessionSearchRoots({}, { wslOpenCodeReaders: [] })).toBe(true)
  expect(
    sameSessionSearchRoots(
      { wslOpenCodeReaders: [ubuntu] },
      { wslOpenCodeReaders: [{ ...ubuntu, executable: '/new/node' }] }
    )
  ).toBe(false)
})
