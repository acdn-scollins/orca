import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawnProcess } from '@orca/process-host'
import { prepareDevCliTerminalWrappers } from './development/launch/dev-cli-terminal-wrapper.mjs'
import { createRecoverySnapshot, recoverProfileIfNeeded } from './local-fork-recovery.mjs'
import { defaultForkProfile, defaultRecoveryRoot } from './local-fork-recovery-providers.mjs'

export async function superviseLocalFork(
  child,
  snapshot,
  { intervalMs = 300_000, retryMs = 10_000 } = {}
) {
  let pending
  let nextAttempt = 0
  const save = () => {
    if (pending) {
      return pending
    }
    pending = Promise.resolve()
      .then(snapshot)
      .then(() => {
        nextAttempt = Date.now() + intervalMs
      })
      .catch((error) => {
        nextAttempt = Date.now() + retryMs
        console.error(`[orca-recovery] ${error.message}`)
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  const timer = setInterval(() => {
    if (Date.now() >= nextAttempt) {
      void save()
    }
  }, retryMs)
  const signalHandlers = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => child.kill(signal)])
  )
  for (const [signal, handler] of signalHandlers) {
    process.on(signal, handler)
  }
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
  })
  void save()
  try {
    return await exited
  } finally {
    clearInterval(timer)
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler)
    }
    await Promise.resolve(pending)
    await save()
  }
}

export async function launchLocalFork(args = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error('Use Node 24 to launch the local fork')
  }
  const root = path.resolve(import.meta.dirname, '../..')
  for (const entry of [
    'out/main/index.js',
    'out/renderer/index.html',
    'out/cli/index.js',
    'out/main/persistence/profile-state/profile-state-access.js'
  ]) {
    if (!existsSync(path.join(root, entry))) {
      throw new Error(`Build the local fork first: missing ${entry}`)
    }
  }
  const profile = defaultForkProfile()
  const recovery = process.env.ORCA_FORK_RECOVERY_ROOT || defaultRecoveryRoot(profile)
  const restored = await recoverProfileIfNeeded({ profile, recovery })
  if (restored.recovered) {
    console.log(`[orca-recovery] Restored profile from ${restored.from}`)
  }
  mkdirSync(profile, { recursive: true, mode: 0o700 })
  const require = createRequire(import.meta.url)
  const electron = require('electron')
  const wrappers = prepareDevCliTerminalWrappers({
    repoRoot: root,
    userDataPath: profile,
    electronExecutable: electron
  })
  const env = {
    ...process.env,
    ORCA_DEV_USER_DATA_PATH: profile,
    ORCA_USER_DATA_PATH: profile,
    ORCA_DEV_REPO_ROOT: root,
    ORCA_DEV_INSTANCE_LABEL: 'Local',
    ORCA_DEV_DOCK_TITLE: 'Orca Local',
    PATH: [wrappers.binDir, path.dirname(process.execPath), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter)
  }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnProcess({
    program: electron,
    args: [root, ...args],
    cwd: root,
    env,
    stdio: 'inherit'
  })
  return superviseLocalFork(child, () => createRecoverySnapshot({ profile, recovery }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.umask(0o077)
  process.exitCode = await launchLocalFork()
}
