import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addArtifact, markConsumed, markExpired, readManifest, writeManifest } from '../../src/workflow/manifest'
import type { ArtifactManifest } from '../../src/workflow/manifest'

describe('workflow artifact manifest', () => {
  let root = ''
  let runDir = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'flt-workflow-manifest-'))
    runDir = join(root, 'run')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('readManifest on missing file returns empty manifest', () => {
    expect(existsSync(join(runDir, 'manifest.json'))).toBe(false)
    expect(readManifest(runDir)).toEqual({ artifacts: [] })
  })

  it('writeManifest then readManifest roundtrip', () => {
    const manifest: ArtifactManifest = {
      artifacts: [
        {
          path: 'handoffs/summary.md',
          type: 'summary',
          owner_agent: 'coder',
          status: 'active',
          keep: false,
        },
      ],
    }

    writeManifest(runDir, manifest)

    expect(readManifest(runDir)).toEqual(manifest)
  })

  it('addArtifact appends without dropping existing entries', () => {
    addArtifact(runDir, {
      path: 'handoffs/summary.md',
      type: 'summary',
      owner_agent: 'coder',
      status: 'active',
      keep: false,
    })
    addArtifact(runDir, {
      path: 'results/coder-_.json',
      type: 'diff',
      owner_agent: 'reviewer',
      status: 'consumed',
      keep: false,
    })

    expect(readManifest(runDir).artifacts).toHaveLength(2)
    expect(readManifest(runDir).artifacts[0]?.path).toBe('handoffs/summary.md')
    expect(readManifest(runDir).artifacts[1]?.path).toBe('results/coder-_.json')
  })

  it('markConsumed flips status', () => {
    addArtifact(runDir, {
      path: 'scratch/notes.md',
      type: 'scratch',
      owner_agent: 'coder',
      status: 'active',
      keep: false,
    })

    markConsumed(runDir, 'scratch/notes.md')

    expect(readManifest(runDir).artifacts[0]?.status).toBe('consumed')
  })

  it('markExpired flips status', () => {
    addArtifact(runDir, {
      path: 'scratch/notes.md',
      type: 'scratch',
      owner_agent: 'coder',
      status: 'active',
      keep: false,
    })

    markExpired(runDir, 'scratch/notes.md')

    expect(readManifest(runDir).artifacts[0]?.status).toBe('expired')
  })
})
