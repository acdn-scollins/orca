import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export function devinTranscriptsInHome(home: string): string {
  return join(home, '.local', 'share', 'devin', 'cli', 'transcripts')
}

export async function writeDevinTranscript(path: string, turns: readonly string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({
      session_id: basename(path, '.json'),
      steps: turns.flatMap((message) => [
        { source: 'user', message, timestamp: '2026-05-01T10:00:00.000Z' },
        { source: 'agent', message: `noted: ${message}`, timestamp: '2026-05-01T10:01:00.000Z' }
      ])
    })
  )
}
