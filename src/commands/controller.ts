import { existsSync, readFileSync, unlinkSync } from 'fs'
import { isControllerRunning, getSocketPath, getPidPath, sendToController } from '../controller/client'
import * as tmux from '../tmux'

const CONTROLLER_SESSION = 'flt-controller'

export async function ensureController(): Promise<void> {
  if (isControllerRunning()) return
  await startController()
}

export async function startController(): Promise<void> {
  if (isControllerRunning()) {
    console.log('Controller already running.')
    return
  }

  // Clean up stale socket/pid
  const sock = getSocketPath()
  const pid = getPidPath()
  if (existsSync(sock)) try { unlinkSync(sock) } catch {}
  if (existsSync(pid)) try { unlinkSync(pid) } catch {}

  // Kill stale tmux session
  if (tmux.hasSession(CONTROLLER_SESSION)) {
    tmux.killSession(CONTROLLER_SESSION)
  }

  // Find the flt repo root for the server script
  const serverScript = `${process.env.HOME}/flt/src/controller/server.ts`
  const command = `bun ${serverScript}`

  tmux.createSession(CONTROLLER_SESSION, process.cwd(), command, {
    FLT_CONTROLLER: '1',
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
  })

  // Wait for socket to appear
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (isControllerRunning()) return
    await Bun.sleep(200)
  }

  throw new Error('Controller failed to start within 10 seconds.')
}

export function stopController(): void {
  const pid = getPidPath()
  if (existsSync(pid)) {
    const pidNum = parseInt(readFileSync(pid, 'utf-8').trim(), 10)
    if (!isNaN(pidNum)) {
      try { process.kill(pidNum, 'SIGTERM') } catch {}
    }
  }

  if (tmux.hasSession(CONTROLLER_SESSION)) {
    tmux.killSession(CONTROLLER_SESSION)
  }

  // Clean up files
  const sock = getSocketPath()
  if (existsSync(sock)) try { unlinkSync(sock) } catch {}
  if (existsSync(pid)) try { unlinkSync(pid) } catch {}

  console.log('Controller stopped.')
}

export async function controllerStatus(): Promise<void> {
  if (!isControllerRunning()) {
    console.log('Controller is not running.')
    return
  }

  const res = await sendToController({ action: 'status', args: {} })
  if (res.ok) {
    const d = res.data as { pid: number; uptime: number; agents: number }
    console.log(`Controller running (pid ${d.pid}, uptime ${Math.round(d.uptime)}s, ${d.agents} agents)`)
  } else {
    console.log(`Controller error: ${res.error}`)
  }
}
