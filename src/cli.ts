#!/usr/bin/env bun

import { Command } from 'commander'
import { spawn } from './commands/spawn'
import { send } from './commands/send'
import { list } from './commands/list'
import { kill } from './commands/kill'
import { logs } from './commands/logs'
import { init } from './commands/init'
import { skillsList } from './commands/skills'
import { presetsAdd, presetsList, presetsRemove } from './commands/presets'
import { listAdapters } from './adapters/registry'

const program = new Command()
  .name('flt')
  .description('Spawn and talk to AI coding agents in any CLI, using tmux')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize fleet orchestrator')
  .option('-o, --orchestrator [name]', 'Spawn an agent orchestrator (optionally named, e.g. -o cairn)')
  .option('-c, --cli <cli>', 'CLI for agent orchestrator', 'claude-code')
  .option('-m, --model <model>', 'Model for agent orchestrator')
  .option('-p, --preset <preset>', 'Preset for agent orchestrator')
  .option('-d, --dir <path>', 'Working directory for agent (created if missing)')
  .action(async (opts) => {
    try {
      await init({
        orchestrator: opts.orchestrator,
        cli: opts.cli,
        model: opts.model,
        preset: opts.preset,
        dir: opts.dir,
      })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('spawn <name>')
  .description('Spawn an agent in a tmux session')
  .option('-c, --cli <cli>', `CLI adapter (${listAdapters().join(', ')})`)
  .option('-p, --preset <name>', 'Preset name to populate CLI/model defaults')
  .option('-m, --model <model>', 'Model to use')
  .option('-d, --dir <path>', 'Working directory (default: cwd)')
  .option('-W, --no-worktree', 'Skip git worktree creation')
  .argument('[bootstrap]', 'Initial message to send after agent is ready')
  .action(async (name, bootstrap, opts) => {
    try {
      await spawn({
        name,
        cli: opts.cli,
        preset: opts.preset,
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
  .command('tail')
  .description('Tail the inbox log (lightweight, no TUI)')
  .action(async () => {
    try {
      const { tail } = await import('./commands/tail')
      await tail()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('logs <name>')
  .description('View agent terminal output')
  .option('-n, --lines <n>', 'Number of lines to show', '100')
  .action((name, opts) => {
    try {
      logs({ name, lines: parseInt(opts.lines, 10) })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const skillsCmd = program
  .command('skills')
  .description('Manage skills')

skillsCmd
  .command('list')
  .description('List available skills')
  .option('-a, --agent <name>', 'Filter by agent name')
  .option('-c, --cli <cli>', 'Filter by CLI adapter')
  .action((opts) => {
    try {
      skillsList({ agent: opts.agent, cli: opts.cli })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const presetsCmd = program
  .command('presets')
  .description('Manage spawn presets')

presetsCmd
  .command('list')
  .description('List all presets')
  .action(() => {
    try {
      presetsList()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

presetsCmd
  .command('add <name>')
  .description('Add a preset')
  .requiredOption('-c, --cli <cli>', `CLI adapter (${listAdapters().join(', ')})`)
  .requiredOption('-m, --model <model>', 'Model to use')
  .option('-D, --description <desc>', 'Optional description')
  .action((name, opts) => {
    try {
      presetsAdd({
        name,
        cli: opts.cli,
        model: opts.model,
        description: opts.description,
      })
      console.log(`Added preset "${name}".`)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

presetsCmd
  .command('remove <name>')
  .description('Remove a preset')
  .action((name) => {
    try {
      presetsRemove({ name })
      console.log(`Removed preset "${name}".`)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program.parse()
