import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { openProfileStateDatabase } from '../../src/main/persistence/profile-state/profile-state-database'
import { importProfileStateJson } from '../../src/main/persistence/profile-state/profile-state-documents'
import { inspectProfile, profileStateAccess } from './local-fork-recovery-files.mjs'
import {
  createRecoverySnapshot,
  recoverProfileIfNeeded,
  retainedGenerations,
  validateGeneration
} from './local-fork-recovery.mjs'
import { superviseLocalFork } from './launch-orca-local.mjs'
import { createDockLaunchPlan } from './local-fork-dock-launcher.mjs'
import { defaultForkProfile } from './local-fork-recovery-providers.mjs'

const roots = []
const closers = []
const THREAD = '01a142dd-fbf4-7892-9c08-34585161e70c'
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const close of closers.splice(0)) {
    close()
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-local-recovery-'))
  roots.push(root)
  const home = path.join(root, 'home')
  const profile = path.join(home, 'profile')
  const recovery = path.join(root, 'recovery')
  const directory = path.join(profile, 'profiles', 'local-default')
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(profile, 'orca-profile-index.json'),
    JSON.stringify({
      activeProfileId: 'local-default',
      profiles: [{ id: 'local-default' }]
    })
  )
  const settings = openProfileStateDatabase(
    path.join(directory, 'profile-state.db'),
    'local-default'
  )
  importProfileStateJson(
    settings.db,
    JSON.stringify({ settings: { theme: 'dark' }, workspaceSession: { saved: true } })
  )
  settings.db.pragma('wal_autocheckpoint=0')
  const journal = new DatabaseSync(path.join(profile, 'agent-session-journal.db'))
  journal.exec(
    'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE agent_session_records(session_id TEXT, record_json TEXT)'
  )
  journal.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run(
    'chat-1',
    JSON.stringify({
      provider: 'codex',
      location: { executionHostId: 'local', wslDistro: null },
      accountHome: { variable: 'CODEX_HOME', path: path.join(home, '.codex') },
      providerHandleChain: [{ handle: { threadId: THREAD } }]
    })
  )
  await writeFile(path.join(profile, 'agent-session-authority.key'), 'synthetic-private-key')
  const orchestration = new DatabaseSync(path.join(profile, 'orchestration.db'))
  orchestration.exec('CREATE TABLE tasks(id TEXT)')
  const codex = path.join(home, '.codex', 'sessions', '2026', '10', `rollout-${THREAD}.jsonl`)
  await mkdir(path.dirname(codex), { recursive: true })
  await writeFile(codex, '{"synthetic":"saved transcript"}\n')
  let closed = false
  const close = () => {
    if (closed) {
      return
    }
    closed = true
    for (const db of [settings.db, journal, orchestration]) {
      db.close()
    }
  }
  closers.push(close)
  return { root, home, profile, recovery, settings, journal, codex, close }
}

it('takes online SQLite snapshots including WAL data and only selected local Codex transcripts', async () => {
  const f = await fixture()
  const saved = await createRecoverySnapshot(f)
  expect(saved.manifest.summary.sessions).toBe(1)
  expect(saved.manifest.providers).toHaveLength(1)
  await validateGeneration(saved, f.profile)
  f.journal.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run('chat-2', '{}')
  expect(inspectProfile(path.join(saved.directory, 'profile')).sessions).toBe(1)
  expect(inspectProfile(f.profile).sessions).toBe(2)
  expect(f.journal.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal')
})

it('restores a missing profile and transcript while preserving newer provider data', async () => {
  const f = await fixture()
  await createRecoverySnapshot(f)
  f.close()
  await rm(f.profile, { recursive: true })
  await rm(f.codex)
  const restored = await recoverProfileIfNeeded(f)
  expect(restored.recovered).toBe(true)
  expect(restored.restoredProviderFiles).toBe(1)
  expect(inspectProfile(f.profile).sessions).toBe(1)
  expect(await readFile(f.codex, 'utf8')).toContain('saved transcript')
  await writeFile(f.codex, 'newer transcript')
  await rm(f.profile, { recursive: true })
  await recoverProfileIfNeeded(f)
  expect(await readFile(f.codex, 'utf8')).toBe('newer transcript')
})

it('restores self-contained managed Codex account ownership and synthetic credentials', async () => {
  const f = await fixture()
  const managedHome = path.join(f.profile, 'codex-accounts', 'synthetic-account', 'home')
  await mkdir(managedHome, { recursive: true })
  await writeFile(path.join(managedHome, '.orca-managed-home'), 'synthetic-owned-home')
  const auth = JSON.stringify({ synthetic: 'credential-placeholder' })
  await writeFile(path.join(managedHome, 'auth.json'), auth)
  await createRecoverySnapshot(f)
  f.close()
  await rm(f.profile, { recursive: true })
  await recoverProfileIfNeeded(f)
  expect(await readFile(path.join(managedHome, '.orca-managed-home'), 'utf8')).toBe(
    'synthetic-owned-home'
  )
  expect(await readFile(path.join(managedHome, 'auth.json'), 'utf8')).toBe(auth)
})

it('keeps WSL-local journal records without selecting their Codex or OpenCode provider files', async () => {
  const f = await fixture()
  const wslThread = '01a142dd-fbf4-7892-9c08-34585161e70d'
  await writeFile(
    path.join(path.dirname(f.codex), `rollout-${wslThread}.jsonl`),
    'unrelated native transcript'
  )
  for (const provider of ['codex', 'opencode']) {
    f.journal.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run(
      `wsl-${provider}`,
      JSON.stringify({
        provider,
        location: { executionHostId: 'local', wslDistro: 'Ubuntu' },
        accountHome: { variable: 'CODEX_HOME', path: '/home/wsl-user/.codex' },
        providerHandleChain: [{ handle: { threadId: wslThread } }]
      })
    )
  }
  const opencodePath = path.join(f.home, '.local', 'share', 'opencode', 'opencode.db')
  await mkdir(path.dirname(opencodePath), { recursive: true })
  const opencode = new DatabaseSync(opencodePath)
  opencode.exec('CREATE TABLE synthetic_native_state(id TEXT)')
  opencode.close()
  const saved = await createRecoverySnapshot(f)
  expect(saved.manifest.summary.sessions).toBe(3)
  expect(saved.manifest.providers.map((entry) => entry.target)).toEqual([f.codex])
})

it('accepts an intentional empty profile without reviving deleted conversations or settings', async () => {
  const f = await fixture()
  await createRecoverySnapshot(f)
  f.journal.exec('DELETE FROM agent_session_records')
  importProfileStateJson(f.settings.db, '{}')
  expect(await recoverProfileIfNeeded(f)).toEqual({ recovered: false })
  const empty = await createRecoverySnapshot(f)
  expect(empty.manifest.summary.sessions).toBe(0)
  expect(empty.manifest.summary.documents['local-default']).toBe(0)
})

it('falls back from a corrupt newest generation and retains damaged live data', async () => {
  const f = await fixture()
  const old = await createRecoverySnapshot({ ...f, now: 1000 })
  const newest = await createRecoverySnapshot({ ...f, now: 2000 })
  await writeFile(
    path.join(newest.directory, 'profile', 'agent-session-journal.db'),
    'damaged backup'
  )
  f.close()
  await writeFile(path.join(f.profile, 'agent-session-journal.db'), 'damaged live journal')
  const restored = await recoverProfileIfNeeded(f)
  expect(restored.from).toBe(old.directory)
  expect(
    await readFile(path.join(restored.previousProfile, 'agent-session-journal.db'), 'utf8')
  ).toBe('damaged live journal')
})

it('refuses restoration while an existing runtime owns admission, then restores under maintenance', async () => {
  const f = await fixture()
  await createRecoverySnapshot(f)
  f.close()
  const admission = profileStateAccess().acquireProfileStateRuntimeAdmission(f.profile)
  await writeFile(path.join(f.profile, 'agent-session-journal.db'), 'bad')
  await expect(recoverProfileIfNeeded(f)).rejects.toThrow(/in use|unverifiable/)
  expect(await readFile(path.join(f.profile, 'agent-session-journal.db'), 'utf8')).toBe('bad')
  admission.release()
  await recoverProfileIfNeeded(f)
  const maintenance = profileStateAccess().acquireProfileStateMaintenance(f.profile)
  expect(() => profileStateAccess().acquireProfileStateRuntimeAdmission(f.profile)).toThrow()
  maintenance.release()
})

it('preserves all files if no recovery generation verifies', async () => {
  const f = await fixture()
  const saved = await createRecoverySnapshot(f)
  f.close()
  await writeFile(path.join(saved.directory, 'profile', 'agent-session-journal.db'), 'bad backup')
  const live = path.join(f.profile, 'agent-session-journal.db')
  await writeFile(live, 'bad live')
  await expect(recoverProfileIfNeeded(f)).rejects.toThrow('No recovery copy passed')
  expect(await readFile(live, 'utf8')).toBe('bad live')
})

it('rejects traversal, recovery inside the profile, and aliased recovery roots', async () => {
  const f = await fixture()
  await expect(
    createRecoverySnapshot({ ...f, recovery: path.join(f.profile, 'backups') })
  ).rejects.toThrow('outside the live profile')
  const alias = path.join(f.root, 'profile-link')
  if (process.platform !== 'win32') {
    await symlink(f.profile, alias)
    await expect(
      createRecoverySnapshot({ ...f, recovery: path.join(alias, 'backups') })
    ).rejects.toThrow('outside the live profile')
  }
  const saved = await createRecoverySnapshot(f)
  saved.manifest.files['../outside'] = { sha256: 'bad', size: 0 }
  await expect(validateGeneration(saved, f.profile)).rejects.toThrow('Unsafe recovery path')
})

it('refuses provider symlinks and keeps the damaged profile in place', async () => {
  if (process.platform === 'win32') {
    return
  }
  const f = await fixture()
  await createRecoverySnapshot(f)
  f.close()
  await rm(f.codex)
  await symlink(path.join(f.root, 'outside'), f.codex)
  await writeFile(path.join(f.profile, 'agent-session-journal.db'), 'damaged')
  await expect(recoverProfileIfNeeded(f)).rejects.toThrow('symbolic links')
  expect(await readFile(path.join(f.profile, 'agent-session-journal.db'), 'utf8')).toBe('damaged')
})

it('retains twelve recent copies plus one recovery point for seven distinct days', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    directory: String(i),
    manifest: { createdAt: Date.UTC(2026, 9, 29) - i * 86400000 }
  }))
  expect([...retainedGenerations(items)]).toEqual(items.slice(0, 12).map((item) => item.directory))
  expect([...retainedGenerations(items, 3, 7)]).toEqual(
    items.slice(0, 7).map((item) => item.directory)
  )
})

it('retries initial backup failure, repeats on schedule, and takes a final snapshot', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const child = new EventEmitter()
  child.kill = () => {}
  const snapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error('not ready'))
    .mockResolvedValue(undefined)
  const running = superviseLocalFork(child, snapshot, { intervalMs: 1000, retryMs: 100 })
  await vi.advanceTimersByTimeAsync(0)
  expect(snapshot).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(100)
  expect(snapshot).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1000)
  expect(snapshot).toHaveBeenCalledTimes(3)
  child.emit('exit', 0, null)
  expect(await running).toBe(0)
  expect(snapshot).toHaveBeenCalledTimes(4)
  expect(vi.getTimerCount()).toBe(0)
})

it('selects a stable profile across platforms and quotes Dock paths with shell metacharacters', () => {
  expect(defaultForkProfile({}, '/home/test', 'linux')).toBe('/home/test/.config/orca-local')
  expect(defaultForkProfile({}, '/Users/test', 'darwin')).toBe(
    '/Users/test/Library/Application Support/orca-local'
  )
  const plan = createDockLaunchPlan({
    repoRoot: "/tmp/quote' $HOME",
    nodeExecutable: '/node',
    profile: '/profile',
    recovery: '/backups'
  })
  expect(plan.command).toContain("'\\''")
  expect(plan.command).toContain('ORCA_FORK_RECOVERY_ROOT=/backups')
  expect(plan.appleScript).toBe(`do shell script ${JSON.stringify(plan.command)}\n`)
})
