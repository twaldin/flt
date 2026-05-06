# Common gotchas — checks every coder must run before signaling pass

## Python→TypeScript semantic gaps

- **`String.replace(pattern, val)` only replaces FIRST occurrence.** Python's `str.replace()` is global by default; JS isn't. Use `.replaceAll()` or a regex with `/g`.
- **JS classes are NOT callable.** If your interface is a function type (e.g., `type ReflectionLM = (prompt: string) => Promise<string>`), implementations must be plain functions or callable objects, not classes with methods. Wrap class instances as closures: `const fn = (...args) => instance.method(...args)`.
- **`Map` preserves insertion order; plain `{}` does not.** Use `Map<K, V>` when you need ordered iteration. Re-`set()` does NOT move the key in iteration order.
- **`list.extend(other)` mutates in-place.** TS `[...a, ...b]` creates a new array; `a.push(...b)` mutates. Pick deliberately.
- **`Counter.most_common()[::-1][0]` returns least common.** When porting Python Counter quirks, port them as comments in code: `// Python parity: Counter.most_common()[::-1][0] picks LEAST common`.
- **Default parameter mutability differs.** Python `def f(x=[])` shares state across calls (classic bug); TS parameter defaults are evaluated per-call. Don't introduce the Python bug just because you're porting from Python.

## Git / commit hygiene

- **`git log <base>..HEAD` empty = your work isn't committed.** Run this before every `flt workflow pass`.
- **Don't add `Co-Authored-By` trailers.** Don't add Claude/Anthropic attribution to commits, code, or comments.
- **Diff scope: ONLY the files your task names.** No scratch files. No `/tmp/` contents. No `*.md` documentation files unless the task explicitly asks for one.

## TypeScript

- **No `as any`. No `as unknown as`.** Write a real type guard. Use `@ts-expect-error` only with a one-line comment justifying why the cast is intentionally unsafe.
- **`noUncheckedIndexedAccess` is on.** `arr[i]` is `T | undefined`; narrow before use.
- **`exactOptionalPropertyTypes` is on.** `{ x?: number }` does NOT accept `{ x: undefined }` — omit the key.

## Testing

- **TDD where unit-testable.** Write the failing test, watch it fail, then implement.
- **Run the full test path your task names** before signaling pass. Per-file test runs miss integration regressions.
- **If `bun test` fails on the base branch too, it's pre-existing**: note it in your handoff, don't sign-off-block on it.
