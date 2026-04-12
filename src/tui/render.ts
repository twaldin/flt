import { App } from './app'

export async function renderTui(): Promise<void> {
  const app = new App()
  app.start()

  const handleSigInt = (): void => {
    app.stop()
    process.exit(0)
  }

  const handleSigTerm = (): void => {
    app.stop()
    process.exit(0)
  }

  const handleWinch = (): void => {
    app.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24)
  }

  process.on('SIGINT', handleSigInt)
  process.on('SIGTERM', handleSigTerm)
  process.on('SIGWINCH', handleWinch)

  await new Promise<void>(() => {})
}
