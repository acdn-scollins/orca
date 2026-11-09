import { createHash } from 'node:crypto'
import { constants, createReadStream, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  lstat,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const builtProfileState = path.resolve(
  import.meta.dirname,
  '../../out/main/persistence/profile-state'
)

export function profileStateAccess() {
  return require(path.join(builtProfileState, 'profile-state-access.js'))
}

export const PROFILE_ENTRIES = [
  'profiles',
  'profile-move-intents',
  'orca-profile-index.json',
  'orca-profile-index.json.bak',
  'agent-session-journal.db',
  'agent-session-authority.key',
  'orchestration.db',
  'agent-session-attachments',
  'agent-model-catalog.json',
  'codex-pane-accounts.json',
  'codex-accounts',
  'codex-runtime-home',
  'floating-workspace',
  'http1-compatibility.json',
  'mobile-notification-dismissals.json',
  'native-chat-pastes',
  'native-chat-visuals',
  'orca-e2ee-keypair.json',
  'orca-devices.json',
  'orca-relay-region-preference.json',
  'orca-stats.json',
  'terminal-history'
]

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  const handle = await open(temporary, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, file)
  await syncDirectory(path.dirname(file))
}

export async function syncDirectory(directory) {
  if (process.platform === 'win32') {
    return
  }
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function within(root, relative) {
  const result = path.resolve(root, relative)
  const tail = path.relative(path.resolve(root), result)
  if (!tail || tail === '..' || tail.startsWith(`..${path.sep}`) || path.isAbsolute(tail)) {
    throw new Error(`Unsafe recovery path: ${relative}`)
  }
  return result
}

export async function* walkFiles(root, relative = '') {
  let entries
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return
    }
    throw error
  }
  for (const entry of entries) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(root, name)
    } else if (entry.isFile()) {
      yield name
    }
  }
}

export async function fileDigest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export function queryDatabase(file, read) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 2000 })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

export function checkDatabase(file) {
  return queryDatabase(file, (db) => {
    const result = db.prepare('PRAGMA quick_check').all()
    if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') {
      throw new Error(`Database integrity check failed: ${file}`)
    }
  })
}

export async function snapshotDatabase(source, target) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const { default: Database } = require(
    path.join(builtProfileState, '../../sqlite/sync-database.js')
  )
  const { writeProfileStateDatabaseSnapshotAsync } = require(
    path.join(builtProfileState, 'profile-state-database-snapshot.js')
  )
  const db = new Database(source, { readonly: true, fileMustExist: true, timeout: 2000 })
  try {
    await writeProfileStateDatabaseSnapshotAsync(db, target, {
      validateStagedSnapshot: checkDatabase
    })
  } finally {
    db.close()
  }
}

export async function snapshotFile(source, target) {
  if (!(await lstat(source)).isFile()) {
    throw new Error(`Recovery source must be a regular file: ${source}`)
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  if (source.endsWith('.db') || source.endsWith('.sqlite')) {
    await snapshotDatabase(source, target)
  } else {
    const digest = await fileDigest(source)
    await copyFile(source, target, constants.COPYFILE_FICLONE)
    await chmod(target, 0o600)
    if ((await fileDigest(target)) !== digest) {
      throw new Error(`File changed during backup: ${source}`)
    }
  }
  const handle = await open(target, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  return { sha256: await fileDigest(target), size: (await stat(target)).size }
}

export function inspectProfile(profile) {
  const index = JSON.parse(readFileSync(path.join(profile, 'orca-profile-index.json'), 'utf8'))
  if (
    !Array.isArray(index.profiles) ||
    !index.profiles.some((p) => p.id === index.activeProfileId)
  ) {
    throw new Error('The profile index is incomplete')
  }
  const documents = {}
  const { readProfileStateDomains } = require(
    path.join(builtProfileState, 'profile-state-domain-reader.js')
  )
  for (const item of index.profiles) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id)) {
      throw new Error('Invalid profile id')
    }
    const file = within(profile, path.join('profiles', item.id, 'profile-state.db'))
    checkDatabase(file)
    const domains = queryDatabase(file, (db) =>
      db
        .prepare('SELECT domain FROM profile_state_documents')
        .all()
        .map((r) => r.domain)
    )
    const checked = readProfileStateDomains(file, item.id, [...domains, 'automationRuns'])
    if (checked.kind === 'unreadable') {
      if (
        checked.error.code === 'unreadable' &&
        checked.error.cause?.message?.startsWith('Unsupported profile state database schema:')
      ) {
        throw Object.assign(new Error('The saved profile requires its normal startup migration'), {
          code: 'migration-required'
        })
      }
      throw checked.error
    }
    documents[item.id] = checked.values.size
  }
  const journal = path.join(profile, 'agent-session-journal.db')
  for (const database of [journal, path.join(profile, 'orchestration.db')]) {
    if (existsSync(database)) {
      checkDatabase(database)
    }
  }
  const sessions = existsSync(journal)
    ? queryDatabase(
        journal,
        (db) => db.prepare('SELECT count(*) AS n FROM agent_session_records').get().n
      )
    : null
  if (
    sessions !== null &&
    !readFileSync(path.join(profile, 'agent-session-authority.key')).length
  ) {
    throw new Error('The journal authority key is missing')
  }
  return { sessions, documents }
}
