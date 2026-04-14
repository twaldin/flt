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
import { cronList, cronAdd, cronRemove } from './commands/cron'
import { activity } from './commands/activity'

const program = new Command()
  .name('flt')
  .description('Spawn and talk to AI coding agents in any CLI, using tmux')
  .version(require('../package.json').version)

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
  .command('tui')
  .description('Launch the fleet TUI (read-only observer)')
  .action(async () => {
    try {
      const { tui } = await import('./commands/init')
      await tui()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('exit')
  .description('Shut down the fleet: cancel workflows, kill all agents, stop controller')
  .action(async () => {
    try {
      const { exit } = await import('./commands/exit')
      await exit()
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
  .option('--parent <name>', 'Override parent agent for messaging')
  .option('--persistent', 'Mark agent as persistent (shows as respawning when dead)')
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
        parent: opts.parent,
        persistent: opts.persistent,
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
  .action(async (name) => {
    try {
      await kill({ name })
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

const workflowCmd = program
  .command('workflow')
  .description('Manage multi-step agent workflows')

workflowCmd
  .command('run <name>')
  .description('Start a workflow from ~/.flt/workflows/')
  .option('--parent <name>', 'Who gets notified on completion')
  .option('-t, --task <task>', 'Task description (available as {task} in step templates)')
  .option('-d, --dir <path>', 'Working directory for agent steps')
  .action(async (name, opts) => {
    try {
      const { workflowRun } = await import('./commands/workflow')
      await workflowRun(name, { parent: opts.parent, task: opts.task, dir: opts.dir })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('status [name]')
  .description('Show workflow run status')
  .action((name) => {
    try {
      const { workflowStatus } = require('./commands/workflow')
      workflowStatus(name)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('list')
  .description('List workflow definitions and runs')
  .action(() => {
    try {
      const { workflowList } = require('./commands/workflow')
      workflowList()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('cancel <name>')
  .description('Cancel a running workflow')
  .action(async (name) => {
    try {
      const { workflowCancel } = await import('./commands/workflow')
      await workflowCancel(name)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('pass')
  .description('Signal PASS from inside a workflow step agent')
  .action(() => {
    try {
      const { workflowPass } = require('./commands/workflow')
      workflowPass()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('fail [reason]')
  .description('Signal FAIL from inside a workflow step agent')
  .action((reason) => {
    try {
      const { workflowFail } = require('./commands/workflow')
      workflowFail(reason)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const controllerCmd = program
  .command('controller')
  .description('Manage the fleet controller daemon')

controllerCmd
  .command('start')
  .description('Start the controller daemon')
  .action(async () => {
    try {
      const { startController } = await import('./commands/controller')
      await startController()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

controllerCmd
  .command('stop')
  .description('Stop the controller daemon')
  .action(() => {
    try {
      const { stopController } = require('./commands/controller')
      stopController()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

controllerCmd
  .command('status')
  .description('Show controller status')
  .action(async () => {
    try {
      const { controllerStatus } = await import('./commands/controller')
      await controllerStatus()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const cronCmd = program
  .command('cron')
  .description('Manage flt cron jobs')

cronCmd
  .command('list')
  .description('List flt crontab entries with status')
  .action(() => {
    try {
      cronList()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

cronCmd
  .command('add <name>')
  .description('Generate and install a crontab entry for an flt agent')
  .requiredOption('--every <interval>', 'Repeat interval (e.g. 30m, 1h, 6h)')
  .option('--send <message>', 'Send message to persistent agent (spawns if not alive)')
  .option('--spawn', 'Spawn ephemeral agent (spawn, wait, kill pattern)')
  .option('--preset <name>', 'Preset for spawned agent (required with --spawn)')
  .option('--dir <path>', 'Working directory for spawned agent')
  .option('--timeout <duration>', 'Max runtime for spawn pattern (default: 5m)')
  .option('--parent <name>', 'Override parent agent (default: human)')
  .option('--bootstrap <message>', 'Initial message for spawned agent')
  .action((name, opts) => {
    try {
      cronAdd(name, {
        every: opts.every,
        send: opts.send,
        spawn: opts.spawn,
        preset: opts.preset,
        dir: opts.dir,
        timeout: opts.timeout,
        parent: opts.parent,
        bootstrap: opts.bootstrap,
      })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

cronCmd
  .command('remove <name>')
  .description('Remove a crontab entry and its script file')
  .action((name) => {
    try {
      cronRemove(name)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('activity')
  .description('Show fleet activity log')
  .option('-n, --lines <n>', 'Number of events to show', '20')
  .option('--type <type>', 'Filter by event type (spawn, kill, status, workflow, message, error)')
  .option('--since <iso>', 'Show events at or after this ISO timestamp')
  .action((opts) => {
    try {
      activity({
        limit: parseInt(opts.lines, 10),
        type: opts.type,
        since: opts.since,
      })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program.parse()
