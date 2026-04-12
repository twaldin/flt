#!/usr/bin/env bun

import { Command } from 'commander'
import { spawn } from './commands/spawn'
import { send } from './commands/send'
import { list } from './commands/list'
import { kill } from './commands/kill'
import { logs } from './commands/logs'
import { init } from './commands/init'
import { listAdapters } from './adapters/registry'

const program = new Command()
  .name('flt')
  .description('Spawn and talk to AI coding agents in any CLI, using tmux')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize fleet orchestrator')
  .option('-o, --orchestrator', 'Spawn an agent orchestrator instead of human mode')
  .option('--cli <cli>', 'CLI for agent orchestrator', 'claude-code')
  .option('--model <model>', 'Model for agent orchestrator')
  .action(async (opts) => {
    try {
      await init({
        orchestrator: opts.orchestrator,
        cli: opts.cli,
        model: opts.model,
      })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('spawn <name>')
  .description('Spawn an agent in a tmux session')
  .requiredOption('--cli <cli>', `CLI adapter (${listAdapters().join(', ')})`)
  .option('--model <model>', 'Model to use')
  .option('--dir <path>', 'Working directory (default: cwd)')
  .option('--no-worktree', 'Skip git worktree creation')
  .argument('[bootstrap]', 'Initial message to send after agent is ready')
  .action(async (name, bootstrap, opts) => {
    try {
      await spawn({
        name,
        cli: opts.cli,
        model: opts.model,
        dir: opts.dir,
        worktree: opts.worktree,
        bootstrap,
      })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('send <target> <message>')
  .description('Send a message to an agent or parent')
  .action(async (target, message) => {
    try {
      await send({ target, message })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('list')
  .description('List all agents with status')
  .action(() => {
    try {
      list()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('kill <name>')
  .description('Kill an agent and clean up')
  .action((name) => {
    try {
      kill({ name })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('logs <name>')
  .description('View agent terminal output')
  .option('-n, --lines <n>', 'Number of lines', '100')
  .action((name, opts) => {
    try {
      logs({ name, lines: parseInt(opts.lines, 10) })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program.parse()
