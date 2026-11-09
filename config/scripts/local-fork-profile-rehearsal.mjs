import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

process.umask(0o077)
assert.equal(process.env.ORCA_BACKGROUND_LAUNCH, '1')
const candidateRoot = path.resolve(import.meta.dirname, '../..')
const receiptFile = path.join(candidateRoot, '.tmp', 'synthetic-profile-rehearsal.json')
const load = (root, file) => import(pathToFileURL(path.join(root, file)).href)
const writeJson = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 })
const databaseFile = (profile) =>
  path.join(profile, 'profiles', 'local-default', 'profile-state.db')

function oldSourceCommit(oldRoot) {
  const require = createRequire(path.join(oldRoot, 'package.json'))
  const result = require('@orca/process-host').runProcessSync({
    program: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: oldRoot,
    timeoutMs: 10_000
  })
  assert.equal(result.code, 0)
  return result.stdout.trim()
}

function profileDigests(root, relative = '') {
  return Object.fromEntries(
    readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const name = path.join(relative, entry.name)
        assert(!lstatSync(path.join(root, name)).isSymbolicLink())
        return entry.isDirectory()
          ? Object.entries(profileDigests(root, name))
          : [
              [
                name,
                createHash('sha256')
                  .update(readFileSync(path.join(root, name)))
                  .digest('hex')
              ]
            ]
      })
  )
}

function readReceipt() {
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))
  assert.equal(receipt.kind, 'synthetic-profile-rehearsal')
  assert.equal(receipt.candidateRoot, candidateRoot)
  assert.equal(path.basename(receipt.root).startsWith('omr-'), true)
  assert.equal(path.dirname(receipt.profile), receipt.root)
  assert.equal(receipt.profile, path.join(receipt.root, 'candidate'))
  assert.deepEqual(profileDigests(receipt.original), receipt.originalDigests)
  return receipt
}

async function verifyProfile(root, profile, theme, expectParts) {
  const { openProfileStateDatabaseReadOnly } = await load(
    root,
    'src/main/persistence/profile-state/profile-state-database.ts'
  )
  const { readProfileStateParsedSnapshot } = await load(
    root,
    'src/main/persistence/profile-state/profile-state-documents.ts'
  )
  const opened = openProfileStateDatabaseReadOnly(databaseFile(profile), 'local-default')
  try {
    assert.equal(opened.db.pragma('user_version', { simple: true }), 3)
    const parts = opened.db
      .prepare("SELECT name FROM sqlite_master WHERE name='profile_state_document_parts'")
      .get()
    assert.equal(parts !== undefined, expectParts)
    const { state } = readProfileStateParsedSnapshot(opened.db)
    assert.equal(state.settings.theme, theme)
    assert.equal(
      state.repos.find((repo) => repo.id === 'rehearsal-repo').displayName,
      'Migration Fixture'
    )
    assert.equal(
      state.projectGroups.find((group) => group.id === 'rehearsal-group').name,
      'Migration Project'
    )
    const folder = state.folderWorkspaces.find((workspace) => workspace.id === 'rehearsal-folder')
    assert.equal(folder.name, 'Migration Workspace')
    assert.equal(folder.comment, 'synthetic migration marker')
    assert.equal(
      state.projects.some((project) => project.sourceRepoIds.includes('rehearsal-repo')),
      true
    )
  } finally {
    opened.db.close()
  }
}

const command = process.argv[2] ?? 'prepare'
const theme = command === 'prepare' ? 'dark' : (process.argv[3] ?? 'dark')
assert(['dark', 'light'].includes(theme))

if (command === 'prepare') {
  assert(process.argv[3], 'Usage: local-fork-profile-rehearsal.mjs prepare <old-checkout>')
  const oldRoot = path.resolve(process.argv[3])
  assert.notEqual(oldRoot, candidateRoot, 'Prepare requires a separate old checkout')
  const oldCommit = oldSourceCommit(oldRoot)
  assert(
    !existsSync(receiptFile),
    'A receipt already exists; reuse this synthetic run instead of preparing again'
  )
  const root = mkdtempSync(
    path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'omr-')
  )
  chmodSync(root, 0o700)
  const original = path.join(root, 'original')
  const profile = path.join(root, 'candidate')
  const rollback = path.join(root, 'rollback')
  const recovery = path.join(root, 'recovery')
  const workspace = path.join(root, 'workspace')
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  mkdirSync(path.dirname(databaseFile(original)), { recursive: true, mode: 0o700 })
  const { getDefaultPersistedState } = await load(oldRoot, 'src/shared/constants.ts')
  const { createDefaultLocalOrcaProfile, ORCA_PROFILE_INDEX_SCHEMA_VERSION } = await load(
    oldRoot,
    'src/shared/orca-profiles.ts'
  )
  const { projectHostSetupProjectionFromRepos } = await load(
    oldRoot,
    'src/shared/project-host-setup-projection.ts'
  )
  const { openProfileStateDatabase } = await load(
    oldRoot,
    'src/main/persistence/profile-state/profile-state-database.ts'
  )
  const { importProfileStateJson } = await load(
    oldRoot,
    'src/main/persistence/profile-state/profile-state-documents.ts'
  )
  const state = getDefaultPersistedState(path.join(profile, 'home'))
  state.settings.theme = 'dark'
  state.repos = [
    {
      id: 'rehearsal-repo',
      path: workspace,
      kind: 'folder',
      displayName: 'Migration Fixture',
      badgeColor: '#737373',
      addedAt: 1,
      projectGroupId: 'rehearsal-group'
    }
  ]
  const projected = projectHostSetupProjectionFromRepos(state.repos)
  state.projects = projected.projects
  state.projectHostSetups = projected.setups
  state.projectGroups = [
    {
      id: 'rehearsal-group',
      name: 'Migration Project',
      parentPath: workspace,
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 1,
      updatedAt: 1
    }
  ]
  state.folderWorkspaces = [
    {
      id: 'rehearsal-folder',
      projectGroupId: 'rehearsal-group',
      name: 'Migration Workspace',
      folderPath: workspace,
      linkedTask: null,
      comment: 'synthetic migration marker',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1
    }
  ]
  writeJson(path.join(original, 'orca-profile-index.json'), {
    schemaVersion: ORCA_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId: 'local-default',
    profiles: [createDefaultLocalOrcaProfile(1)]
  })
  const opened = openProfileStateDatabase(databaseFile(original), 'local-default')
  try {
    importProfileStateJson(opened.db, JSON.stringify(state))
    assert.equal(opened.db.pragma('user_version', { simple: true }), 3)
    assert.equal(
      opened.db
        .prepare("SELECT name FROM sqlite_master WHERE name='profile_state_document_parts'")
        .get(),
      undefined
    )
  } finally {
    opened.db.close()
  }
  cpSync(original, profile, { recursive: true })
  cpSync(original, rollback, { recursive: true })
  const { createElectronHomeIsolation } = await load(
    oldRoot,
    'tests/e2e/helpers/electron-home-isolation.ts'
  )
  const isolation = createElectronHomeIsolation({
    inheritedEnv: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', TMPDIR: path.join(root, 'tmp') },
    launchEnv: {},
    extraEnv: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' },
    userDataDir: profile
  })
  mkdirSync(path.join(root, 'tmp'), { mode: 0o700 })
  const env = {
    ...isolation.env,
    ORCA_DEV_USER_DATA_PATH: profile,
    ORCA_FORK_RECOVERY_ROOT: recovery,
    XDG_CONFIG_HOME: path.join(isolation.isolatedHome, '.config'),
    XDG_DATA_HOME: path.join(isolation.isolatedHome, '.local', 'share'),
    XDG_CACHE_HOME: path.join(isolation.isolatedHome, '.cache')
  }
  assert.equal(env.HOME, isolation.isolatedHome)
  assert.equal(env.ORCA_E2E_HOME_DIR, isolation.isolatedHome)
  assert.notEqual(env.HOME, isolation.realHome)
  writeJson(path.join(root, 'launch-env.json'), env)
  const receipt = {
    kind: 'synthetic-profile-rehearsal',
    oldCommit,
    oldRoot,
    candidateRoot,
    root,
    original,
    profile,
    rollback,
    recovery,
    isolatedHome: isolation.isolatedHome,
    launchEnvFile: path.join(root, 'launch-env.json'),
    originalDigests: profileDigests(original)
  }
  mkdirSync(path.dirname(receiptFile), { recursive: true, mode: 0o700 })
  writeJson(receiptFile, receipt)
  await verifyProfile(oldRoot, rollback, 'dark', false)
  assert.deepEqual(profileDigests(original), receipt.originalDigests)
  console.log(
    JSON.stringify({
      prepared: true,
      oldSchema: 3,
      oldParts: false,
      oldCodeReadback: true,
      receiptFile,
      ...receipt
    })
  )
} else if (command === 'old') {
  const receipt = readReceipt()
  assert.equal(oldSourceCommit(receipt.oldRoot), receipt.oldCommit)
  await verifyProfile(receipt.oldRoot, receipt.rollback, 'dark', false)
  assert.deepEqual(profileDigests(receipt.original), receipt.originalDigests)
  console.log(JSON.stringify({ oldCodeReadback: true, untouchedOriginal: true }))
} else if (command === 'candidate') {
  const receipt = readReceipt()
  await verifyProfile(candidateRoot, receipt.profile, theme, true)
  console.log(
    JSON.stringify({
      candidateReadback: true,
      schema: 3,
      splitTables: true,
      theme,
      untouchedOriginal: true
    })
  )
} else if (command === 'recovery') {
  const receipt = readReceipt()
  const { createRecoverySnapshot, recoverProfileIfNeeded } = await load(
    candidateRoot,
    'config/scripts/local-fork-recovery.mjs'
  )
  const options = {
    profile: receipt.profile,
    recovery: receipt.recovery,
    home: receipt.isolatedHome
  }
  const saved = await createRecoverySnapshot(options)
  const { acquireProfileStateMaintenance } = await load(
    candidateRoot,
    'src/main/persistence/profile-state/profile-state-access.ts'
  )
  const maintenance = acquireProfileStateMaintenance(receipt.profile)
  try {
    renameSync(databaseFile(receipt.profile), path.join(receipt.root, 'withheld-profile-state.db'))
  } finally {
    maintenance.release()
  }
  const restored = await recoverProfileIfNeeded(options)
  assert.equal(restored.recovered, true)
  assert.equal(restored.from, saved.directory)
  await verifyProfile(candidateRoot, receipt.profile, theme, true)
  assert.deepEqual(profileDigests(receipt.original), receipt.originalDigests)
  console.log(JSON.stringify({ recoveryReadback: true, theme, untouchedOriginal: true }))
} else {
  throw new Error(`Unknown rehearsal command: ${command}`)
}
