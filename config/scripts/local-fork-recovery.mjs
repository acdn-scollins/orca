import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import lockfile from 'proper-lockfile'
import {
  atomicJson,
  fileDigest,
  inspectProfile,
  PROFILE_ENTRIES,
  profileStateAccess,
  readJson,
  snapshotFile,
  syncDirectory,
  walkFiles,
  within
} from './local-fork-recovery-files.mjs'
import { providerFiles } from './local-fork-recovery-providers.mjs'

const exists = (file) =>
  access(file).then(
    () => true,
    () => false
  )

export function processMayBeAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

async function withRecoveryLock(profile, recovery, action) {
  const relative = path.relative(await canonicalPath(profile), await canonicalPath(recovery))
  if (
    !relative ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  ) {
    throw new Error('Recovery copies must be outside the live profile')
  }
  await mkdir(recovery, { recursive: true, mode: 0o700 })
  const release = await lockfile.lock(recovery, { retries: 0, stale: 120_000, update: 30_000 })
  try {
    return await action()
  } finally {
    await release()
  }
}

async function canonicalPath(file) {
  try {
    return await realpath(file)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return path.join(await canonicalPath(path.dirname(path.resolve(file))), path.basename(file))
  }
}

export async function generations(recovery) {
  const entries = await readdir(recovery, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^generation-[0-9]+-[a-f0-9-]+$/.test(entry.name)) {
      continue
    }
    const directory = path.join(recovery, entry.name)
    try {
      const manifest = await readJson(path.join(directory, 'manifest.json'))
      if (Number.isSafeInteger(manifest.createdAt) && manifest.createdAt > 0) {
        items.push({ directory, manifest })
      }
    } catch {
      // An interrupted generation is preserved but never selected.
    }
  }
  return items.sort((a, b) => b.manifest.createdAt - a.manifest.createdAt)
}

async function profileFiles(profile) {
  const files = []
  for (const entry of PROFILE_ENTRIES) {
    const source = path.join(profile, entry)
    const info = await lstat(source).catch((error) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (!info) {
      continue
    }
    if (info.isSymbolicLink()) {
      throw new Error(`Recovery cannot follow a symbolic link: ${source}`)
    }
    const relatives = info.isDirectory() ? walkFiles(profile, entry) : [entry]
    for await (const relative of relatives) {
      if (/\.db\.backup\.|-(wal|shm|journal)$/.test(relative)) {
        continue
      }
      files.push({ source: path.join(profile, relative), relative: path.join('profile', relative) })
    }
  }
  return files
}

export async function validateGeneration({ directory, manifest }, profile) {
  if (
    manifest.schemaVersion !== 1 ||
    path.resolve(manifest.profilePath) !== path.resolve(profile)
  ) {
    throw new Error('Recovery generation belongs to a different profile')
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = within(directory, relative)
    const info = await lstat(file)
    if (
      !info.isFile() ||
      info.size !== expected.size ||
      (await fileDigest(file)) !== expected.sha256
    ) {
      throw new Error(`Recovery file failed verification: ${relative}`)
    }
  }
  const summary = inspectProfile(path.join(directory, 'profile'))
  if (JSON.stringify(summary) !== JSON.stringify(manifest.summary)) {
    throw new Error('Recovery database counts do not match the manifest')
  }
  return summary
}

export function retainedGenerations(items, recent = 12, daily = 7) {
  const retained = new Set(items.slice(0, recent).map((item) => item.directory))
  const days = new Set()
  for (const item of items) {
    const day = new Date(item.manifest.createdAt).toISOString().slice(0, 10)
    if (!days.has(day) && days.size < daily) {
      days.add(day)
      retained.add(item.directory)
    }
  }
  return retained
}

export async function createRecoverySnapshot({
  profile,
  recovery,
  home = homedir(),
  now = Date.now()
}) {
  return withRecoveryLock(profile, recovery, async () => {
    if (await exists(path.join(recovery, 'restore-in-progress.json'))) {
      throw new Error('Interrupted recovery must be reviewed before taking a snapshot')
    }
    const previous = await generations(recovery)
    if (
      previous.some((item) => path.resolve(item.manifest.profilePath) !== path.resolve(profile))
    ) {
      throw new Error('Recovery directory belongs to a different profile')
    }
    const admission = profileStateAccess().acquireProfileStateRuntimeAdmission(profile)
    const id = `${now}-${randomUUID()}`
    const stage = path.join(recovery, `.staging-${id}`)
    const directory = path.join(recovery, `generation-${id}`)
    try {
      inspectProfile(profile)
      await mkdir(stage, { mode: 0o700 })
      const manifest = {
        schemaVersion: 1,
        profilePath: path.resolve(profile),
        createdAt: now,
        files: {},
        providers: []
      }
      for (const source of [
        ...(await profileFiles(profile)),
        ...(await providerFiles(profile, home))
      ]) {
        manifest.files[source.relative] = await snapshotFile(
          source.source,
          within(stage, source.relative)
        )
        if (source.restoreRoot) {
          manifest.providers.push({ relative: source.relative, target: source.source })
        }
      }
      manifest.summary = inspectProfile(path.join(stage, 'profile'))
      await atomicJson(path.join(stage, 'manifest.json'), manifest)
      await validateGeneration({ directory: stage, manifest }, profile)
      await rename(stage, directory)
      await syncDirectory(recovery)
      const runtime = await readJson(path.join(profile, 'orca-runtime.json')).catch(() => null)
      await atomicJson(path.join(recovery, 'status.json'), {
        profilePath: path.resolve(profile),
        lastSuccessfulSnapshot: directory,
        lastSuccessfulAt: now,
        lastRuntimePid: runtime?.pid ?? null
      })
      const items = await generations(recovery)
      const retained = retainedGenerations(items)
      for (const item of items) {
        if (path.resolve(item.manifest.profilePath) !== path.resolve(profile)) {
          throw new Error('Recovery directory contains another profile')
        }
        if (!retained.has(item.directory)) {
          await rm(item.directory, { recursive: true })
        }
      }
      return { directory, manifest }
    } finally {
      admission.release()
      await rm(stage, { recursive: true, force: true })
    }
  })
}

async function assertProviderDestination(home, target) {
  within(home, path.relative(home, target))
  let cursor = path.resolve(home)
  for (const part of path.relative(home, target).split(path.sep)) {
    cursor = path.join(cursor, part)
    const info = await lstat(cursor).catch((error) => {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    if (info?.isSymbolicLink()) {
      throw new Error('Provider recovery cannot follow symbolic links')
    }
  }
  if (!(await exists(target)) && /\.(db|sqlite)$/.test(target)) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (await exists(target + suffix)) {
        throw new Error('Provider database sidecars remain; preserve them before restoration')
      }
    }
  }
}

export async function recoverProfileIfNeeded({ profile, recovery, home = homedir() }) {
  return withRecoveryLock(profile, recovery, async () => {
    if (await exists(path.join(recovery, 'restore-in-progress.json'))) {
      throw new Error(
        'An interrupted recovery was preserved. Review restore-in-progress.json before launching Orca.'
      )
    }
    const items = await generations(recovery)
    if (items.some((item) => path.resolve(item.manifest.profilePath) !== path.resolve(profile))) {
      throw new Error('Recovery directory belongs to a different profile')
    }
    const hadProfile = await exists(profile)
    const admission = profileStateAccess().acquireProfileStateRuntimeAdmission(profile)
    try {
      inspectProfile(profile)
      const newest = items[0]?.manifest
      for (const entry of ['agent-session-journal.db', 'orchestration.db']) {
        if (
          newest?.files[path.join('profile', entry)] &&
          !(await exists(path.join(profile, entry)))
        ) {
          throw new Error(`Saved profile file is missing: ${entry}`)
        }
      }
      return { recovered: false }
    } catch (error) {
      if (error.code === 'migration-required') {
        return { recovered: false, migrationRequired: true }
      }
      if (
        ['newer-schema', 'identity-mismatch', 'EACCES', 'EPERM', 'SQLITE_BUSY'].includes(error.code)
      ) {
        throw error
      }
      if (!items.length) {
        const savedEntries = await Promise.all(
          PROFILE_ENTRIES.map((entry) => exists(path.join(profile, entry)))
        )
        if (!savedEntries.some(Boolean)) {
          return { recovered: false }
        }
        throw new Error(
          `Saved profile needs recovery, but no verified backup is available: ${error.message}`
        )
      }
    } finally {
      admission.release()
    }
    const maintenance = profileStateAccess().acquireProfileStateMaintenance(profile)
    try {
      const runtime = await readJson(path.join(profile, 'orca-runtime.json')).catch(() => null)
      if (processMayBeAlive(runtime?.pid)) {
        throw new Error('Quit the existing Orca process before recovering its profile')
      }
      let selected
      for (const item of items) {
        try {
          await validateGeneration(item, profile)
          selected = item
          break
        } catch {
          // Fall back only to a complete verified generation.
        }
      }
      if (!selected) {
        throw new Error('No recovery copy passed verification; damaged data was preserved')
      }
      for (const provider of selected.manifest.providers) {
        await assertProviderDestination(home, provider.target)
        if (!Object.hasOwn(selected.manifest.files, provider.relative)) {
          throw new Error('Provider recovery entry is missing')
        }
      }
      const stage = `${profile}.restoring-${randomUUID()}`
      const quarantine = `${profile}.before-recovery-${Date.now()}-${randomUUID()}`
      await mkdir(stage, { mode: 0o700 })
      await mkdir(quarantine, { mode: 0o700 })
      const moved = []
      const installed = []
      const marker = path.join(recovery, 'restore-in-progress.json')
      try {
        for (const relative of Object.keys(selected.manifest.files)) {
          if (!relative.startsWith(`profile${path.sep}`)) {
            continue
          }
          const target = within(stage, path.relative('profile', relative))
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
          await copyFile(within(selected.directory, relative), target)
        }
        inspectProfile(stage)
        await atomicJson(marker, { profile, stage, quarantine, from: selected.directory })
        for (const entry of PROFILE_ENTRIES) {
          maintenance.assertActive()
          if (await exists(path.join(profile, entry))) {
            await rename(path.join(profile, entry), path.join(quarantine, entry))
            moved.push(entry)
          }
          for (const suffix of ['-wal', '-shm', '-journal']) {
            if (await exists(path.join(profile, entry + suffix))) {
              await rename(
                path.join(profile, entry + suffix),
                path.join(quarantine, entry + suffix)
              )
              moved.push(entry + suffix)
            }
          }
          if (await exists(path.join(stage, entry))) {
            await rename(path.join(stage, entry), path.join(profile, entry))
            installed.push(entry)
          }
        }
        await syncDirectory(profile)
        let restoredProviderFiles = 0
        for (const provider of selected.manifest.providers) {
          if (await exists(provider.target)) {
            continue
          }
          await mkdir(path.dirname(provider.target), { recursive: true, mode: 0o700 })
          try {
            await copyFile(
              within(selected.directory, provider.relative),
              provider.target,
              constants.COPYFILE_EXCL
            )
            restoredProviderFiles++
          } catch (error) {
            if (error.code !== 'EEXIST') {
              throw error
            }
          }
        }
        const receipt = {
          recovered: true,
          from: selected.directory,
          previousProfile: hadProfile ? quarantine : null,
          restoredProviderFiles,
          summary: selected.manifest.summary
        }
        await atomicJson(path.join(recovery, 'last-recovery.json'), receipt)
        await rm(marker)
        await rm(stage, { recursive: true, force: true })
        return receipt
      } catch (error) {
        for (const entry of installed.toReversed()) {
          await rm(path.join(profile, entry), { recursive: true, force: true })
        }
        for (const entry of moved.toReversed()) {
          await rename(path.join(quarantine, entry), path.join(profile, entry))
        }
        await rm(marker, { force: true })
        await rm(stage, { recursive: true, force: true })
        throw error
      }
    } finally {
      maintenance.release()
    }
  })
}
