import { describe, it, expect } from 'bun:test'
import { buildFltSkillContent } from '../../src/flt-skill'

describe('buildFltSkillContent', () => {
  const base = {
    name: 'reviewer-1',
    parent: 'orchestrator',
    cli: 'claude-code',
    model: 'sonnet',
    worktree: true,
  }

  it('emits frontmatter + agent identity in every variant', () => {
    const content = buildFltSkillContent(base)
    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toContain('name: flt')
    expect(content).toContain('description:')
    expect(content).toContain('agent **reviewer-1**')
    expect(content).toContain('Parent: **orchestrator**')
    expect(content).toContain('CLI: **claude-code**')
    expect(content).toContain('Model: **sonnet**')
  })

  it('includes subagent etiquette when parent is another agent', () => {
    const content = buildFltSkillContent(base)
    expect(content).toContain('Mode: **subagent**')
    expect(content).toContain('Comms (subagent)')
    expect(content).toContain('flt send parent')
    expect(content).toContain('flt ask oracle')
    expect(content).not.toContain('Comms (root agent)')
    expect(content).not.toContain('Workflow protocol')
  })

  it('includes root etiquette when parent is human', () => {
    const content = buildFltSkillContent({ ...base, parent: 'human' })
    expect(content).toContain('Mode: **root**')
    expect(content).toContain('Comms (root agent)')
    expect(content).not.toContain('Comms (subagent)')
    expect(content).not.toContain('Workflow protocol')
  })

  it('includes workflow protocol when inside a workflow run', () => {
    const content = buildFltSkillContent({
      ...base,
      workflow: 'idea-to-pr',
      step: 'coder',
    })
    expect(content).toContain('Mode: **workflow**')
    expect(content).toContain('Workflow protocol')
    expect(content).toContain('idea-to-pr / coder')
    expect(content).toContain('flt workflow pass')
    expect(content).toContain('flt workflow fail')
    expect(content).not.toContain('Comms (subagent)')
    expect(content).not.toContain('Comms (root agent)')
  })

  it('appends worktree section only when worktree is true', () => {
    const wt = buildFltSkillContent({ ...base, worktree: true })
    expect(wt).toContain('## Worktree')

    const noWt = buildFltSkillContent({ ...base, worktree: false })
    expect(noWt).not.toContain('## Worktree')
  })

  it('substitutes {{name}} into ask oracle hint for subagents', () => {
    const content = buildFltSkillContent({ ...base, name: 'spec-1' })
    expect(content).toContain('--from spec-1')
  })
})
