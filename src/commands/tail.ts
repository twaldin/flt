import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { getStateDir } from '../state'
import { getInboxPath } from './init'

export async function tail(): Promise<void> {
  const inboxPath = getInboxPath()
  mkdirSync(getStateDir(), { recursive: true })
  if (!existsSync(inboxPath)) {
    writeFileSync(inboxPath, '')
  }

  console.log('Tailing inbox. Agent messages appear below. Ctrl+C to exit.')
  console.log('─'.repeat(60))

  let lastSize = readFileSync(inboxPath).length

  const check = () => {
    try {
      const content = readFileSync(inboxPath)
      if (content.length > lastSize) {
        const newBytes = content.subarray(lastSize)
        process.stdout.write(newBytes.toString())
        lastSize = content.length
      }
    } catch {}
  }

  const interval = setInterval(check, 500)

  process.on('SIGINT', () => {
    clearInterval(interval)
    console.log('\nStopped tailing.')
    process.exit(0)
  })

  await new Promise(() => {})
}
