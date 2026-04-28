#!/usr/bin/env bun

import { Command } from 'commander'
import { spawn } from './commands/spawn'
import { send } from './commands/send'
import { list } from './commands/list'
import { kill } from './commands/kill'
import { logs } from './commands/logs'
import { init } from './commands/init'
import { skillsList, skillImport, skillMoveFromClaude } from './commands/skills'
import { presetsAdd, presetsList, presetsRemove } from './commands/presets'
import { listAdapters } from './adapters/registry'
import { cronList, cronAdd, cronRemove } from './commands/cron'
import { activity } from './commands/activity'
import { modelsResolve } from './commands/models'
import { pluginAudit, pluginUninstall } from './commands/plugins'
import { promote } from './commands/promote'
import { traceRecent } from './commands/trace'
import { gates, blockers } from './commands/gates'

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
  .option('--skill <name>', 'Enable a skill for this spawn (repeatable)', (value, prev: string[]) => [...prev, value], [])
  .option('--all-skills', 'Enable all discoverable skills for this spawn')
  .option('--no-model-resolve', 'Disable CLI-specific model alias resolution (raw passthrough)')
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
        skills: opts.skill,
        allSkills: opts.allSkills,
        noModelResolve: opts.modelResolve === false,
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
  .option('--preserve-worktree', 'Keep the worktree dir (next workflow step / manual recovery may need it)')
  .action(async (name, opts) => {
    try {
      await kill({ name, preserveWorktree: opts.preserveWorktree })
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

const skillCmd = program
  .command('skill')
  .description('Manage skills')

skillCmd
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

skillCmd
  .command('import <path>')
  .description('Import a skill directory into ~/.flt/skills/')
  .action((path) => {
    try {
      skillImport({ src: path })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

skillCmd
  .command('move-from-claude')
  .description('Bulk-migrate skills from ~/.claude/skills/ and ~/.claude/anthropic-skills/ into ~/.flt/skills/')
  .action(() => {
    try {
      skillMoveFromClaude({})
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

const modelsCmd = program
  .command('models')
  .description('Model alias resolution helpers')

modelsCmd
  .command('resolve <alias>')
  .description('Resolve a model alias for a specific CLI')
  .requiredOption('-c, --cli <cli>', `CLI adapter (${listAdapters().join(', ')})`)
  .option('--no-resolve', 'Disable resolution (debug passthrough)')
  .action((alias, opts) => {
    try {
      modelsResolve({ alias, cli: opts.cli, noResolve: opts.resolve === false })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('ask <target> [question]')
  .description('Ask the oracle, or `flt ask human <json>` (stdin if json omitted) for structured questions')
  .option('--from <name>', 'Caller agent name; default = human')
  .option('--run-id <id>', 'Tag the question with a run-id (default = _unrouted)')
  .option('--timeout <ms>', 'Timeout in milliseconds', (v) => parseInt(v, 10))
  .action(async (target, question, opts) => {
    try {
      if (target === 'oracle') {
        if (!question) {
          console.error('flt ask oracle requires a question argument')
          process.exit(1)
        }
        const { askOracle } = await import('./commands/ask')
        await askOracle(question, { from: opts.from, timeoutMs: opts.timeout })
        return
      }
      if (target === 'human') {
        const raw = question ?? await readStdin()
        if (!raw || raw.trim().length === 0) {
          console.error('flt ask human requires JSON via argv or stdin')
          process.exit(1)
        }
        let parsed: unknown
        try { parsed = JSON.parse(raw) } catch (e) {
          console.error(`flt ask human: invalid JSON: ${(e as Error).message}`)
          process.exit(1)
        }
        const { askHuman } = await import('./commands/ask')
        const result = await askHuman(parsed as { questions: unknown[] } as Parameters<typeof askHuman>[0], {
          runId: opts.runId,
          timeoutMs: opts.timeout,
        })
        console.log(JSON.stringify(result, null, 2))
        if (result.status === 'timeout') process.exit(2)
        return
      }
      console.error(`Unknown ask target "${target}". Supported: oracle, human.`)
      process.exit(1)
    } catch (e) {
      console.error('Error: ' + (e as Error).message)
      process.exit(1)
    }
  })

const qnaCmd = program
  .command('qna')
  .description('Browse and export Q&A pairs from agent-initiated questions')

qnaCmd
  .command('list')
  .description('List all Q&A rows')
  .option('--json', 'Output as JSON')
  .option('--pending', 'Only unanswered questions')
  .option('--run-id <id>', 'Filter to a specific run-id')
  .option('--qna-dir <path>', 'Override qna directory (test-only)')
  .action(async (opts) => {
    const { qnaList } = await import('./commands/qna')
    qnaList({
      qnaDir: opts.qnaDir,
      json: opts.json,
      pendingOnly: opts.pending,
      runId: opts.runId,
    })
  })

qnaCmd
  .command('show <questionId>')
  .description('Show a question + its answer (if any)')
  .option('--run-id <id>', 'Filter to a specific run-id')
  .option('--qna-dir <path>', 'Override qna directory (test-only)')
  .action(async (questionId, opts) => {
    const { qnaShow } = await import('./commands/qna')
    qnaShow({ questionId, runId: opts.runId, qnaDir: opts.qnaDir })
  })

qnaCmd
  .command('export')
  .description('Export Q&A as JSONL (default) or JSON for mutator/GEPA training')
  .option('--format <fmt>', 'jsonl | json (default jsonl)')
  .option('--since <ms>', 'Only rows newer than N ms', (v) => parseInt(v, 10))
  .option('--pending', 'Only unanswered questions')
  .option('--qna-dir <path>', 'Override qna directory (test-only)')
  .action(async (opts) => {
    const { qnaExport } = await import('./commands/qna')
    qnaExport({
      qnaDir: opts.qnaDir,
      format: opts.format === 'json' ? 'json' : 'jsonl',
      sinceMs: opts.since,
      pendingOnly: opts.pending,
    })
  })

qnaCmd
  .command('answer <questionId>')
  .description('Submit an answer for a pending question (modal/CLI side)')
  .requiredOption('--selected <labels>', 'Comma-separated selected labels')
  .option('--text <text>', 'Free-text answer (for text-type questions)')
  .option('--run-id <id>', 'Run id of the question')
  .option('--qna-dir <path>', 'Override qna directory (test-only)')
  .action(async (questionId, opts) => {
    const { qnaAnswer } = await import('./commands/qna')
    qnaAnswer({
      qnaDir: opts.qnaDir,
      runId: opts.runId,
      questionId,
      selected: String(opts.selected).split(',').map((s: string) => s.trim()).filter(Boolean),
      text: opts.text,
    })
  })

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  let buf = ''
  for await (const chunk of process.stdin) buf += chunk
  return buf
}

program
  .command('promote <candidate>')
  .description('Promote a candidate artifact into stable after evidence checks')
  .requiredOption('--evidence <run-ids>', 'Comma-separated run ids (e.g. run-a,run-b)')
  .action((candidate, opts) => {
    try {
      const evidenceRunIds = String(opts.evidence)
        .split(',')
        .map((id: string) => id.trim())
        .filter(Boolean)
      const result = promote({ candidate, evidenceRunIds })
      console.log(`Promoted ${candidate} -> ${result.stablePath}`)
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
  .option('-n, --n <count>', 'Spawn N independent runs (workflow-level parallel)', (v) => parseInt(v, 10))
  .option('--slug <slug>', 'Override the auto-derived id slug; default is derived from --task')
  .action(async (name, opts) => {
    try {
      const { workflowRun } = await import('./commands/workflow')
      await workflowRun(name, { parent: opts.parent, task: opts.task, dir: opts.dir, n: opts.n, slug: opts.slug })
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
  .command('advance <run>')
  .description('Manually fire advanceWorkflow for a stuck run (idempotent escape-hatch)')
  .action(async (run) => {
    try {
      const { workflowAdvance } = await import('./commands/workflow')
      await workflowAdvance(run)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('rename <run>')
  .description('Backfill-rename a terminal workflow run with a slug-based id')
  .option('--slug <slug>', 'Slug to use; default derives from the run\'s original --task')
  .action(async (run, opts) => {
    try {
      const { workflowRename } = await import('./commands/workflow')
      await workflowRename(run, { slug: opts.slug })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

workflowCmd
  .command('approve <run>')
  .description('Approve a paused human_gate step')
  .option('--candidate <label>', 'For merge_best gates: pick a parallel candidate label')
  .action(async (run, opts) => {
    try {
      const { workflowApprove } = await import('./commands/workflow')
      await workflowApprove(run, { candidate: opts.candidate })
    } catch (e) {
      console.error('Error: ' + (e as Error).message)
      process.exit(1)
    }
  })

workflowCmd
  .command('reject <run>')
  .description('Reject a paused human_gate step')
  .option('--reason <text>', 'Why rejected', '')
  .action(async (run, opts) => {
    try {
      const { workflowReject } = await import('./commands/workflow')
      await workflowReject(run, opts.reason)
    } catch (e) {
      console.error('Error: ' + (e as Error).message)
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

const evalCmd = program
  .command('eval')
  .description('Manage held-out eval suites for workflow benchmarking')

const evalSuiteCmd = evalCmd
  .command('suite')
  .description('Eval suite operations')

evalSuiteCmd
  .command('list')
  .description('List available fixtures under tests/eval/')
  .action(() => {
    try {
      const { evalSuiteList } = require('./commands/eval')
      evalSuiteList()
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

evalSuiteCmd
  .command('run <name>')
  .description('Run the configured workflow against an eval fixture')
  .option('--workflow <name>', 'Override the fixture\'s configured workflow')
  .option('--parent <name>', 'Who gets notified on completion (default: human)')
  .action(async (name, opts) => {
    try {
      const { evalSuiteRun } = await import('./commands/eval')
      await evalSuiteRun(name, { workflow: opts.workflow, parent: opts.parent })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const artifactCmd = program
  .command('artifact')
  .description('Workflow artifact maintenance')

artifactCmd
  .command('gc')
  .description('Run GC tier transitions over workflow runs')
  .option('--run <id>', 'GC a single run')
  .option('--older-than <duration>', 'Only consider runs older than this (e.g. 7d, 45d)')
  .action(async (opts) => {
    try {
      const { gcRun, gcAllRuns } = await import('./workflow/gc')
      if (opts.run) {
        const join = (await import('path')).join
        const home = process.env.HOME ?? require('os').homedir()
        const runDir = join(home, '.flt', 'runs', opts.run)
        const result = gcRun(runDir)
        console.log('[' + result.tier + '] ' + opts.run + ': ' + result.actions.join(', '))
      } else {
        const results = gcAllRuns({ olderThan: opts.olderThan })
        for (const r of results) console.log('[' + r.tier + '] ' + r.runId + ': ' + r.actions.join(', '))
      }
    } catch (e) {
      console.error('Error: ' + (e as Error).message)
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
  .command('gates')
  .description('Show pending gates across all workflow runs')
  .option('--json', 'Output as JSON')
  .option('--watch', 'Watch and re-render on changes')
  .option('--runs-dir <path>', 'Override runs directory (test-only)') // test-only
  .action(async (opts) => {
    try {
      await gates({ json: opts.json, watch: opts.watch, runsDir: opts.runsDir })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program
  .command('blockers')
  .description('Show workflow blocker reports')
  .option('--json', 'Output as JSON')
  .option('--watch', 'Watch and re-render on changes')
  .option('--runs-dir <path>', 'Override runs directory (test-only)') // test-only
  .action(async (opts) => {
    try {
      await blockers({ json: opts.json, watch: opts.watch, runsDir: opts.runsDir })
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

const traceCmd = program
  .command('trace')
  .description('Workflow trace utilities')

traceCmd
  .command('recent')
  .description('List recent workflow runs as tab-separated rows')
  .requiredOption('--since <duration>', 'Lookback duration (e.g. 30m, 6h, 7d)')
  .option('--status <status>', 'Filter by outcome: failed|passed|all', 'all')
  .action((opts) => {
    try {
      const status = String(opts.status)
      if (status !== 'failed' && status !== 'passed' && status !== 'all') {
        throw new Error(`Invalid status: ${status}. Expected failed, passed, or all.`)
      }
      traceRecent({ since: String(opts.since), status })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const pluginCmd = program
  .command('plugin')
  .description('Manage Claude Code plugins')

pluginCmd
  .command('audit')
  .description('Audit installed plugins and write a recommendation report to plugin-audit.md')
  .action(() => {
    try {
      pluginAudit({})
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

pluginCmd
  .command('uninstall')
  .description('Interactively uninstall plugins flagged for removal')
  .option('--confirm', 'Enable actual uninstall (prompts y/n per plugin)')
  .action(async (opts) => {
    try {
      await pluginUninstall({ confirm: !!opts.confirm })
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

const routeCmd = program
  .command('route')
  .description('Routing decisions for agent roles')

routeCmd
  .command('show <role>')
  .description('Show routing decision for a role')
  .option('--tags <tags>', 'Comma-separated task tags (e.g. security,auth)')
  .option('--budget <tier>', 'Budget tier: low, medium, high')
  .action((role, opts) => {
    try {
      const { resolveRoute } = require('./routing/resolver')
      const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined
      const budget = opts.budget as 'low' | 'medium' | 'high' | undefined
      const decision = resolveRoute(role, tags, budget)
      console.log(JSON.stringify(decision, null, 2))
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

routeCmd
  .command('check')
  .description('Smoke-test every (role → preset → cli, model) row in policy.yaml')
  .option('--force', 'Bypass smoke cache (re-run every check)')
  .option('--json', 'Emit raw JSON instead of a table')
  .action(async (opts) => {
    try {
      const { runRouteCheck } = require('./commands/route-check')
      const { exitCode } = await runRouteCheck({ force: !!opts.force, json: !!opts.json })
      process.exit(exitCode)
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`)
      process.exit(1)
    }
  })

program.parse()
