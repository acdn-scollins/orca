import path from 'node:path'
import { homedir } from 'node:os'
import { access, realpath } from 'node:fs/promises'
import { chatJournalFile, queryDatabase, walkFiles, within } from './local-fork-recovery-files.mjs'

export function defaultForkProfile(
  env = process.env,
  home = homedir(),
  platform = process.platform
) {
  if (env.ORCA_DEV_USER_DATA_PATH) {
    return path.resolve(env.ORCA_DEV_USER_DATA_PATH)
  }
  const appData =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
        : env.XDG_CONFIG_HOME || path.join(home, '.config')
  return path.join(appData, 'orca-local')
}

export function defaultRecoveryRoot(profile) {
  const name = path.basename(profile)
  return path.join(homedir(), 'Documents', 'Codex', 'Orca Recovery', name)
}

export async function providerFiles(profile, home = homedir()) {
  const journal = chatJournalFile(profile)
  if (!journal) {
    return []
  }
  const records = queryDatabase(journal, (db) =>
    db
      .prepare('SELECT record_json FROM agent_session_records')
      .all()
      .map((r) => JSON.parse(r.record_json))
  )
  const threadIds = new Set()
  const homes = new Set([path.join(home, '.codex')])
  let hasOpenCode = false
  for (const record of records) {
    if (
      (record.location?.executionHostId && record.location.executionHostId !== 'local') ||
      record.location?.wslDistro
    ) {
      continue
    }
    if (record.provider === 'opencode') {
      hasOpenCode = true
    }
    if (record.provider !== 'codex') {
      continue
    }
    if (record.accountHome?.variable === 'CODEX_HOME') {
      homes.add(within(home, path.relative(home, record.accountHome.path)))
    }
    for (const link of record.providerHandleChain ?? []) {
      if (link.handle?.threadId) {
        threadIds.add(link.handle.threadId)
      }
    }
  }
  const files = []
  const seen = new Set()
  const canonicalHome = await realpath(home)
  let homeIndex = 0
  for (const root of homes) {
    const label = `codex-${homeIndex++}`
    for (const folder of ['sessions', 'archived_sessions']) {
      const directory = await realpath(path.join(root, folder)).catch((error) => {
        if (error.code !== 'ENOENT') {
          throw error
        }
        return null
      })
      if (!directory) {
        continue
      }
      within(canonicalHome, path.relative(canonicalHome, directory))
      for await (const relative of walkFiles(directory)) {
        if (!/\.jsonl(?:\.zst)?$/.test(relative)) {
          continue
        }
        const id = path
          .basename(relative)
          .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
        const source = path.join(home, path.relative(canonicalHome, directory), relative)
        if (id && threadIds.has(id) && !seen.has(source)) {
          seen.add(source)
          files.push({
            source,
            relative: path.join('providers', label, folder, relative),
            restoreRoot: root
          })
        }
      }
    }
  }
  const data =
    home === homedir()
      ? process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
      : path.join(home, '.local', 'share')
  const opencode = path.join(data, 'opencode', 'opencode.db')
  if (
    hasOpenCode &&
    (await access(opencode).then(
      () => true,
      () => false
    ))
  ) {
    files.push({
      source: opencode,
      relative: path.join('providers', 'opencode', 'opencode.db'),
      restoreRoot: path.dirname(opencode)
    })
  }
  return files
}
