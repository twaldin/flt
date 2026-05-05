import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

export interface FltManifest {
  fltOnlyFiles: string[]
  fltModifiedFiles: string[]
}

const MANIFEST_PATH = join('.flt', 'manifest.json')
const HOOK_SENTINEL = '# flt-managed-hook'

function hooksDir(workdir: string): string {
  return join(workdir, '.git', 'hooks')
}

function hookFile(workdir: string, name: string): string {
  return join(hooksDir(workdir), name)
}

function isFltHook(content: string): boolean {
  return content.includes(HOOK_SENTINEL)
}

export function writeFltManifest(workdir: string, manifest: FltManifest): void {
  mkdirSync(join(workdir, '.flt'), { recursive: true })
  writeFileSync(
    join(workdir, MANIFEST_PATH),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  )
}

export function readFltManifest(workdir: string): FltManifest {
  const path = join(workdir, MANIFEST_PATH)
  if (!existsSync(path)) return { fltOnlyFiles: [], fltModifiedFiles: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return { fltOnlyFiles: [], fltModifiedFiles: [] }
    const obj = parsed as Record<string, unknown>
    const fltOnlyFiles = Array.isArray(obj.fltOnlyFiles)
      ? obj.fltOnlyFiles.filter((v): v is string => typeof v === 'string')
      : []
    const fltModifiedFiles = Array.isArray(obj.fltModifiedFiles)
      ? obj.fltModifiedFiles.filter((v): v is string => typeof v === 'string')
      : []
    return { fltOnlyFiles, fltModifiedFiles }
  } catch {
    return { fltOnlyFiles: [], fltModifiedFiles: [] }
  }
}

// Builds the pre-commit hook script body. Both hooks use the same strip logic;
// pre-push additionally checks HEAD for leaked flt markers.
function buildPreCommitScript(): string {
  return [
    '#!/usr/bin/env bash',
    HOOK_SENTINEL,
    'set -e',
    '',
    'MANIFEST=".flt/manifest.json"',
    '',
    'if [ -f "$MANIFEST" ]; then',
    '  # Remove flt-only files from the index',
    '  while IFS= read -r f; do',
    '    [ -z "$f" ] && continue',
    '    if git ls-files --error-unmatch --cached -- "$f" >/dev/null 2>&1; then',
    '      git rm --cached --force --quiet -- "$f"',
    '    fi',
    "  done < <(python3 -c \"import json; d=json.load(open('$MANIFEST')); [print(x) for x in d.get('fltOnlyFiles', [])]\" 2>/dev/null || true)",
    '',
    '  # Strip flt blocks from modified files in the index',
    '  while IFS= read -r f; do',
    '    [ -z "$f" ] && continue',
    '    if git ls-files --error-unmatch --cached -- "$f" >/dev/null 2>&1; then',
    '      mode=$(git ls-files -s -- "$f" | awk \'{print $1}\')',
    '      content=$(git show ":$f")',
    '      stripped=$(printf \'%s\' "$content" | python3 -c "',
    'import sys, re',
    'data = sys.stdin.read()',
    "cleaned = re.sub(r'<!-- flt:start -->.*?<!-- flt:end -->', '', data, flags=re.DOTALL)",
    'sys.stdout.write(cleaned)',
    '")',
    '      hash=$(printf \'%s\' "$stripped" | git hash-object -w --stdin)',
    '      git update-index --cacheinfo "$mode,$hash,$f"',
    '    fi',
    "  done < <(python3 -c \"import json; d=json.load(open('$MANIFEST')); [print(x) for x in d.get('fltModifiedFiles', [])]\" 2>/dev/null || true)",
    'fi',
    '',
    '# Chain to user hook if present',
    'if [ -x ".git/hooks/pre-commit.user" ]; then',
    '  exec ".git/hooks/pre-commit.user" "$@"',
    'fi',
    '',
    'exit 0',
  ].join('\n') + '\n'
}

function buildPrePushScript(): string {
  return [
    '#!/usr/bin/env bash',
    HOOK_SENTINEL,
    'set -e',
    '',
    'MANIFEST=".flt/manifest.json"',
    '',
    '# Guard: fail push if any flt markers leaked into HEAD of modified files',
    'if [ -f "$MANIFEST" ]; then',
    '  while IFS= read -r f; do',
    '    [ -z "$f" ] && continue',
    '    if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then',
    '      if git show "HEAD:$f" 2>/dev/null | grep -q "<!-- flt:start -->"; then',
    '        echo "flt: refusing push — flt block found in committed $f. Run git commit to strip it first." >&2',
    '        exit 1',
    '      fi',
    '    fi',
    "  done < <(python3 -c \"import json; d=json.load(open('$MANIFEST')); [print(x) for x in d.get('fltModifiedFiles', [])]\" 2>/dev/null || true)",
    'fi',
    '',
    '# Chain to user hook if present',
    'if [ -x ".git/hooks/pre-push.user" ]; then',
    '  exec ".git/hooks/pre-push.user" "$@"',
    'fi',
    '',
    'exit 0',
  ].join('\n') + '\n'
}

function installHook(workdir: string, hookName: string, content: string): void {
  const dir = hooksDir(workdir)
  mkdirSync(dir, { recursive: true })

  const path = hookFile(workdir, hookName)
  const userPath = hookFile(workdir, `${hookName}.user`)

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf-8')
    if (isFltHook(existing)) return  // already installed, skip
    // Existing user hook — rename to .user so we can chain it
    if (!existsSync(userPath)) {
      renameSync(path, userPath)
    }
  }

  writeFileSync(path, content, 'utf-8')
  chmodSync(path, 0o755)
}

function uninstallHook(workdir: string, hookName: string): void {
  const path = hookFile(workdir, hookName)
  const userPath = hookFile(workdir, `${hookName}.user`)

  if (!existsSync(path)) return

  const content = readFileSync(path, 'utf-8')
  if (!isFltHook(content)) return  // not ours, leave it alone

  rmSync(path)

  if (existsSync(userPath)) {
    renameSync(userPath, path)
  }
}

export function installHooks(workdir: string): void {
  installHook(workdir, 'pre-commit', buildPreCommitScript())
  installHook(workdir, 'pre-push', buildPrePushScript())
}

export function uninstallHooks(workdir: string): void {
  uninstallHook(workdir, 'pre-commit')
  uninstallHook(workdir, 'pre-push')
}
