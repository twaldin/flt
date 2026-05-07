# Vendored skills — attribution

The following skill directories under `templates/skills/` are vendored from
[mattpocock/skills](https://github.com/mattpocock/skills) (MIT-licensed) and
distributed unchanged except where noted:

- `diagnose/`
- `git-guardrails-claude-code/`
- `grill-with-docs/` — **modified**: added a `<question-dispatch>` block that
  routes questions through `flt ask human` when flt is installed (so the Q/A
  is persisted to `~/.flt/qna/` for the mutator/GEPA loop), falling back to
  the native `AskUserQuestion` tool otherwise. Upstream content (CONTEXT.md /
  ADR awareness, doc-update flow) is preserved.
- `handoff/`
- `improve-codebase-architecture/`
- `prototype/`
- `setup-pre-commit/`
- `tdd/`
- `to-issues/`
- `to-prd/`
- `triage/`
- `write-a-skill/`
- `zoom-out/`

Pinned to upstream commit `70141119e9fe47430b62b93bcf166a73e6580048`.

## Upstream license

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
