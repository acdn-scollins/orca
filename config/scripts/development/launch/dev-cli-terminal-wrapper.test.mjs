import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { runProcessSync } from '@orca/process-host'
import { prepareDevCliTerminalWrappers } from './dev-cli-terminal-wrapper.mjs'

it.skipIf(process.platform === 'win32')(
  'preserves literal POSIX paths and arguments with shell metacharacters',
  () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'orca-dev-terminal-literal-'))
    try {
      const root = path.join(temporary, "repo ' $HOME `printf expanded` $(printf expanded)")
      const userDataPath = path.join(root, 'profile " $HOME')
      const electronExecutable = path.join(root, 'electron `printf expanded`')
      const { binDir } = prepareDevCliTerminalWrappers({
        repoRoot: root,
        userDataPath,
        electronExecutable,
        platform: 'linux'
      })
      mkdirSync(path.join(root, 'out', 'cli'))
      writeFileSync(
        path.join(root, 'out', 'cli', 'index.js'),
        'process.stdout.write(JSON.stringify({ profile: process.env.ORCA_USER_DATA_PATH, executable: process.env.ORCA_APP_EXECUTABLE, args: process.argv.slice(2) }))'
      )
      const args = ['literal $HOME', 'quote\'"', 'line\nbreak']
      const result = runProcessSync({
        program: '/bin/bash',
        args: [path.join(binDir, 'orca-dev'), ...args]
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        profile: userDataPath,
        executable: electronExecutable,
        args
      })
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
)
