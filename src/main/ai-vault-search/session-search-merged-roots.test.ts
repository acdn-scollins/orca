import './session-search-worker.test-fixture'
import { chmod, rm } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { resetSessionParseCacheForTests } from '../ai-vault/parse-cache/session-parse-cache-store'
import { resetTranscriptConsumersForTests } from '../ai-vault/transcripts/session-transcript-consumers'
import type SyncDatabase from '../sqlite/sync-database'
import { SessionSearchIndexer } from './session-search-indexer'
import {
  devinTranscriptsInHome,
  writeDevinTranscript
} from './session-search-merged-source-fixture'
import {
  FakeSessionSearchClock,
  openSessionSearchIndexerHarness,
  type SessionSearchIndexerHarness
} from './session-search-indexer-test-fixture'

const CAN_DENY_READ = process.platform !== 'win32' && process.getuid?.() !== 0
const INTERVAL_MS = 20_000

let harness: SessionSearchIndexerHarness
let clock: FakeSessionSearchClock
let indexer: SessionSearchIndexer

beforeEach(async () => {
  resetSessionParseCacheForTests()
  resetTranscriptConsumersForTests()
  clock = new FakeSessionSearchClock()
  harness = await openSessionSearchIndexerHarness('ss-merged-roots')
  harness.roots.wslHomeDirs = [join(harness.root, 'wsl-home')]
})

afterEach(async () => {
  await indexer.close()
  resetTranscriptConsumersForTests()
  resetSessionParseCacheForTests()
  await harness.cleanup()
})

function devinTranscript(root: string, name: string): string {
  return join(root, `${name}.json`)
}

function sessionsMatching(term: string): string[] {
  return harness.read((db: SyncDatabase) =>
    (
      db
        .prepare(
          `SELECT DISTINCT s.session_id AS id FROM messages_fts
           JOIN messages m ON m.id = messages_fts.rowid
           JOIN sessions s ON s.id = m.session_row_id
           WHERE messages_fts MATCH ? ORDER BY s.session_id`
        )
        .all(term) as { id: string }[]
    ).map((row) => row.id)
  )
}

it.skipIf(!CAN_DENY_READ)('fences one merged root without taking its partner down', async () => {
  const current = harness.roots.devinTranscriptsDir ?? ''
  const secondary = devinTranscriptsInHome(join(harness.root, 'wsl-home'))
  const mounted = devinTranscript(current, 'mounted-session')
  const local = devinTranscript(secondary, 'local-session')
  await writeDevinTranscript(mounted, ['a conversation on the mounted volume'])
  await writeDevinTranscript(local, ['a conversation on local disk'])

  indexer = new SessionSearchIndexer({
    databasePath: harness.databasePath,
    roots: harness.roots,
    historyDays: null,
    clock,
    reconcileIntervalMs: INTERVAL_MS
  })
  await indexer.start()
  expect(sessionsMatching('conversation').sort()).toEqual(['local-session', 'mounted-session'])

  await chmod(current, 0o000)
  try {
    await indexer.reconcile({ full: true })

    const status = indexer.status()
    const degraded = status.degradedRoots.map((root) => root.root)
    expect(degraded).toContain(current)
    expect(degraded.every((root) => !root.includes(delimiter))).toBe(true)
    expect(sessionsMatching('mounted')).toEqual(['mounted-session'])
  } finally {
    await chmod(current, 0o755)
  }
})

it('retires from one merged root while its partner is healthy', async () => {
  const current = harness.roots.devinTranscriptsDir ?? ''
  const secondary = devinTranscriptsInHome(join(harness.root, 'wsl-home'))
  const going = devinTranscript(current, 'going-session')
  await writeDevinTranscript(going, ['a conversation about to be deleted'])
  // Keep a sibling so deletion does not trigger empty-root grace.
  await writeDevinTranscript(devinTranscript(current, 'sibling-session'), [
    'a conversation beside it'
  ])
  await writeDevinTranscript(devinTranscript(secondary, 'staying-session'), [
    'a conversation that stays'
  ])

  indexer = new SessionSearchIndexer({
    databasePath: harness.databasePath,
    roots: harness.roots,
    historyDays: null,
    clock,
    reconcileIntervalMs: INTERVAL_MS
  })
  await indexer.start()
  expect(sessionsMatching('conversation').sort()).toEqual([
    'going-session',
    'sibling-session',
    'staying-session'
  ])

  await rm(going)
  await indexer.reconcile({ full: true })

  expect(sessionsMatching('deleted')).toEqual([])
  expect(indexer.status().degradedRoots).toEqual([])
  expect(sessionsMatching('conversation').sort()).toEqual(['sibling-session', 'staying-session'])
})
