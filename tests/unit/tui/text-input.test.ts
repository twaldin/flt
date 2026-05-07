import { describe, expect, test } from 'bun:test'
import {
  TextInput,
  parseRawKey,
  wordBoundaryLeft,
  wordBoundaryRight,
  lineStart,
  lineEnd,
  wrapForDisplay,
} from '../../../src/tui/widgets/text-input'

describe('TextInput cursor movement', () => {
  test('left/right move one char with clamping at edges', () => {
    const ti = new TextInput({ initialValue: 'abc' })
    expect(ti.getCursor()).toBe(3)
    ti.handleKey('left')
    expect(ti.getCursor()).toBe(2)
    ti.handleKey('right')
    ti.handleKey('right')
    expect(ti.getCursor()).toBe(3)
    ti.handleKey('right')
    expect(ti.getCursor()).toBe(3) // clamps
    ti.setCursor(0)
    ti.handleKey('left')
    expect(ti.getCursor()).toBe(0) // clamps
  })

  test('word-left jumps to start of word', () => {
    const ti = new TextInput({ initialValue: 'foo bar baz' })
    ti.handleKey('word-left')
    expect(ti.getCursor()).toBe(8) // start of "baz"
    ti.handleKey('word-left')
    expect(ti.getCursor()).toBe(4) // start of "bar"
    ti.handleKey('word-left')
    expect(ti.getCursor()).toBe(0) // start of "foo"
  })

  test('word-right jumps to end of word', () => {
    const ti = new TextInput({ initialValue: 'foo bar baz' })
    ti.setCursor(0)
    ti.handleKey('word-right')
    expect(ti.getCursor()).toBe(3) // end of "foo"
    ti.handleKey('word-right')
    expect(ti.getCursor()).toBe(7) // end of "bar"
    ti.handleKey('word-right')
    expect(ti.getCursor()).toBe(11) // end of "baz"
  })

  test('word-jumps treat punctuation as separators', () => {
    expect(wordBoundaryLeft('foo.bar', 7)).toBe(4)
    expect(wordBoundaryRight('foo.bar', 0)).toBe(3)
  })

  test('home/end jump to line boundaries (multi-line)', () => {
    const ti = new TextInput({ mode: 'multi', initialValue: 'line one\nline two\nline three' })
    ti.setCursor(15) // middle of "line two"
    ti.handleKey('home')
    expect(ti.getCursor()).toBe(9) // start of "line two"
    ti.handleKey('end')
    expect(ti.getCursor()).toBe(17) // end of "line two"
  })

  test('line-start / line-end aliases work', () => {
    const ti = new TextInput({ initialValue: 'hello world' })
    ti.setCursor(5)
    ti.handleKey('line-start')
    expect(ti.getCursor()).toBe(0)
    ti.handleKey('line-end')
    expect(ti.getCursor()).toBe(11)
  })
})

describe('TextInput backspace/delete edge cases', () => {
  test('backspace at start is a no-op', () => {
    const ti = new TextInput({ initialValue: 'abc' })
    ti.setCursor(0)
    ti.handleKey('backspace')
    expect(ti.getValue()).toBe('abc')
    expect(ti.getCursor()).toBe(0)
  })

  test('backspace deletes one char left and moves cursor', () => {
    const ti = new TextInput({ initialValue: 'abc' })
    ti.handleKey('backspace')
    expect(ti.getValue()).toBe('ab')
    expect(ti.getCursor()).toBe(2)
  })

  test('delete at end is a no-op', () => {
    const ti = new TextInput({ initialValue: 'abc' })
    ti.handleKey('delete')
    expect(ti.getValue()).toBe('abc')
    expect(ti.getCursor()).toBe(3)
  })

  test('delete removes char to the right', () => {
    const ti = new TextInput({ initialValue: 'abc' })
    ti.setCursor(1)
    ti.handleKey('delete')
    expect(ti.getValue()).toBe('ac')
    expect(ti.getCursor()).toBe(1)
  })

  test('backspace over newline joins lines', () => {
    const ti = new TextInput({ mode: 'multi', initialValue: 'foo\nbar' })
    ti.setCursor(4) // start of "bar"
    ti.handleKey('backspace')
    expect(ti.getValue()).toBe('foobar')
    expect(ti.getCursor()).toBe(3)
  })

  test('kill-word-back removes preceding word', () => {
    const ti = new TextInput({ initialValue: 'foo bar baz' })
    ti.handleKey('kill-word-back')
    expect(ti.getValue()).toBe('foo bar ')
    expect(ti.getCursor()).toBe(8)
  })

  test('kill-line-back removes from cursor to line start', () => {
    const ti = new TextInput({ initialValue: 'hello world' })
    ti.setCursor(6)
    ti.handleKey('kill-line-back')
    expect(ti.getValue()).toBe('world')
    expect(ti.getCursor()).toBe(0)
  })

  test('kill-line-fwd removes from cursor to line end', () => {
    const ti = new TextInput({ initialValue: 'hello world' })
    ti.setCursor(5)
    ti.handleKey('kill-line-fwd')
    expect(ti.getValue()).toBe('hello')
    expect(ti.getCursor()).toBe(5)
  })

  test('backspace on empty buffer is a no-op', () => {
    const ti = new TextInput({ initialValue: '' })
    ti.handleKey('backspace')
    expect(ti.getValue()).toBe('')
    expect(ti.getCursor()).toBe(0)
  })
})

describe('TextInput history recall (single-line)', () => {
  test('history-prev recalls last entry, history-next returns to draft', () => {
    const history = { entries: ['cmd-a', 'cmd-b', 'cmd-c'] }
    const ti = new TextInput({ mode: 'single', history })
    ti.insert('draft')
    expect(ti.getValue()).toBe('draft')
    ti.handleKey('history-prev')
    expect(ti.getValue()).toBe('cmd-c')
    ti.handleKey('history-prev')
    expect(ti.getValue()).toBe('cmd-b')
    ti.handleKey('history-prev')
    expect(ti.getValue()).toBe('cmd-a')
    ti.handleKey('history-prev') // stays at oldest
    expect(ti.getValue()).toBe('cmd-a')
    ti.handleKey('history-next')
    expect(ti.getValue()).toBe('cmd-b')
    ti.handleKey('history-next')
    ti.handleKey('history-next')
    expect(ti.getValue()).toBe('draft') // back to original draft
  })

  test('Up/Down trigger history nav in single-line mode', () => {
    const history = { entries: ['old'] }
    const ti = new TextInput({ mode: 'single', history })
    ti.handleKey('up')
    expect(ti.getValue()).toBe('old')
    ti.handleKey('down')
    expect(ti.getValue()).toBe('')
  })

  test('typing after recall resets history index', () => {
    const history = { entries: ['old'] }
    const ti = new TextInput({ mode: 'single', history })
    ti.handleKey('up')
    expect(ti.getValue()).toBe('old')
    ti.insert('!')
    expect(ti.getValue()).toBe('old!')
    ti.handleKey('up')
    expect(ti.getValue()).toBe('old')
  })

  test('commit pushes to history (deduped)', () => {
    const entries: string[] = []
    let pushed: string | null = null
    const history = {
      entries,
      push: (v: string) => { entries.push(v); pushed = v },
    }
    const ti = new TextInput({ mode: 'single', history, onSubmit: () => {} })
    ti.setValue('hello')
    ti.handleKey('enter')
    expect(pushed).toBe('hello')
    expect(entries).toEqual(['hello'])
  })
})

describe('TextInput multi-line', () => {
  test('Enter commits in multi mode (Shift+Enter inserts newline)', () => {
    let submitted: string | null = null
    const ti = new TextInput({ mode: 'multi', onSubmit: (v) => { submitted = v } })
    ti.insert('line one')
    ti.handleKey('shift-enter')
    ti.insert('line two')
    expect(ti.getValue()).toBe('line one\nline two')
    ti.handleKey('enter')
    expect(submitted).toBe('line one\nline two')
  })

  test('shift-enter is no-op in single-line mode', () => {
    const ti = new TextInput({ mode: 'single', initialValue: 'foo' })
    const consumed = ti.handleKey('shift-enter')
    expect(consumed).toBe(false)
    expect(ti.getValue()).toBe('foo')
  })

  test('insert strips newlines in single-line mode', () => {
    const ti = new TextInput({ mode: 'single' })
    ti.insert('a\nb')
    expect(ti.getValue()).toBe('a b')
  })

  test('Up/Down move between lines in multi mode', () => {
    const ti = new TextInput({ mode: 'multi', initialValue: 'aaa\nbbbb\nccc' })
    // Cursor at end (12). Up should go to "bbbb" col 3 (since cursor was col 3 of "ccc")
    ti.setCursor(12)
    ti.handleKey('up')
    expect(ti.getCursor()).toBe(7) // index of 'b' before final 'b' wait — verify
    // "aaa\nbbbb\nccc" — positions: a=0,1,2 \n=3 b=4,5,6,7 \n=8 c=9,10,11. End = 12.
    // From end (col 3 of "ccc"), up to "bbbb": col 3 = position 7.
    expect(ti.getCursor()).toBe(7)
    ti.handleKey('up') // to "aaa": col=3 but "aaa" has length 3 → clamp to col 3 = position 3
    expect(ti.getCursor()).toBe(3)
  })

  test('Up at top of multi-buffer falls through to history', () => {
    const history = { entries: ['previous'] }
    const ti = new TextInput({ mode: 'multi', initialValue: 'foo\nbar', history })
    ti.setCursor(2) // in "foo"
    ti.handleKey('up')
    // multi-mode up at top with history falls to history-prev
    expect(ti.getValue()).toBe('previous')
  })
})

describe('TextInput tab completion', () => {
  test('single completion auto-applies', () => {
    const ti = new TextInput({
      complete: () => ({ items: [{ value: 'foobar' }], replaceFrom: 0 }),
    })
    ti.insert('foo')
    return ti.requestCompletion().then(() => {
      expect(ti.getValue()).toBe('foobar')
    })
  })

  test('multiple completions open popup; Tab cycles', async () => {
    const ti = new TextInput({
      complete: () => ({ items: [{ value: 'apple' }, { value: 'apricot' }], replaceFrom: 0 }),
    })
    ti.insert('ap')
    await ti.requestCompletion()
    expect(ti.getCompletion()).not.toBeNull()
    expect(ti.getCompletion()?.selectedIndex).toBe(0)
    ti.handleKey('tab')
    expect(ti.getCompletion()?.selectedIndex).toBe(1)
    ti.handleKey('tab')
    expect(ti.getCompletion()?.selectedIndex).toBe(0)
  })

  test('Enter applies the selected completion', async () => {
    const ti = new TextInput({
      complete: () => ({ items: [{ value: 'first' }, { value: 'second' }], replaceFrom: 0 }),
    })
    await ti.requestCompletion()
    ti.handleKey('tab') // select 'second'
    ti.handleKey('enter')
    expect(ti.getValue()).toBe('second')
    expect(ti.getCompletion()).toBeNull()
  })

  test('Escape cancels the popup without changing buffer', async () => {
    const ti = new TextInput({
      initialValue: 'ap',
      complete: () => ({ items: [{ value: 'apple' }, { value: 'apricot' }], replaceFrom: 0 }),
    })
    await ti.requestCompletion()
    expect(ti.getCompletion()).not.toBeNull()
    ti.handleKey('escape')
    expect(ti.getCompletion()).toBeNull()
    expect(ti.getValue()).toBe('ap')
  })

  test('typing after popup opens closes the popup', async () => {
    const ti = new TextInput({
      initialValue: 'ap',
      complete: () => ({ items: [{ value: 'apple' }, { value: 'apricot' }], replaceFrom: 0 }),
    })
    await ti.requestCompletion()
    expect(ti.getCompletion()).not.toBeNull()
    // Simulate user typing more text — popup should close
    ti.insert('p')
    expect(ti.getCompletion()).toBeNull()
    expect(ti.getValue()).toBe('app')
  })
})

describe('parseRawKey terminal escape variations', () => {
  test('classified key names map directly', () => {
    expect(parseRawKey('left')).toBe('left')
    expect(parseRawKey('right')).toBe('right')
    expect(parseRawKey('alt-backspace')).toBe('kill-word-back')
    expect(parseRawKey('ctrl-w')).toBe('kill-word-back')
    expect(parseRawKey('ctrl-u')).toBe('kill-line-back')
    expect(parseRawKey('ctrl-k')).toBe('kill-line-fwd')
    expect(parseRawKey('ctrl-a')).toBe('line-start')
    expect(parseRawKey('ctrl-e')).toBe('line-end')
  })

  test('raw escape sequences for word jumps', () => {
    // ESC b / ESC f
    expect(parseRawKey('?', Buffer.from('\x1bb'))).toBe('word-left')
    expect(parseRawKey('?', Buffer.from('\x1bf'))).toBe('word-right')
    // CSI variants
    expect(parseRawKey('?', Buffer.from('\x1b[1;3D'))).toBe('word-left')
    expect(parseRawKey('?', Buffer.from('\x1b[1;3C'))).toBe('word-right')
    expect(parseRawKey('?', Buffer.from('\x1b[1;9D'))).toBe('word-left')
    expect(parseRawKey('?', Buffer.from('\x1b[1;9C'))).toBe('word-right')
  })

  test('Home/End variants', () => {
    expect(parseRawKey('?', Buffer.from('\x1b[H'))).toBe('home')
    expect(parseRawKey('?', Buffer.from('\x1bOH'))).toBe('home')
    expect(parseRawKey('?', Buffer.from('\x1b[1~'))).toBe('home')
    expect(parseRawKey('?', Buffer.from('\x1b[F'))).toBe('end')
    expect(parseRawKey('?', Buffer.from('\x1b[4~'))).toBe('end')
  })
})

describe('wrapForDisplay', () => {
  test('wraps long lines and tracks cursor', () => {
    const r = wrapForDisplay('hellohello', 5, 7)
    expect(r.lines).toEqual(['hello', 'hello'])
    expect(r.cursorRow).toBe(1)
    expect(r.cursorCol).toBe(2)
  })

  test('hard newlines start a new row', () => {
    const r = wrapForDisplay('foo\nbar', 10, 4)
    expect(r.lines).toEqual(['foo', 'bar'])
    expect(r.cursorRow).toBe(1)
    expect(r.cursorCol).toBe(0)
  })

  test('cursor at end of a wrap-filled line falls onto next visual row', () => {
    const r = wrapForDisplay('hello', 5, 5)
    expect(r.lines.length).toBeGreaterThanOrEqual(2)
    expect(r.cursorRow).toBe(1)
    expect(r.cursorCol).toBe(0)
  })

  test('empty buffer renders one empty row with cursor at 0,0', () => {
    const r = wrapForDisplay('', 10, 0)
    expect(r.lines).toEqual([''])
    expect(r.cursorRow).toBe(0)
    expect(r.cursorCol).toBe(0)
  })
})

describe('integration: simulated keystrokes drive the buffer', () => {
  test('simulate typing + edit + commit', () => {
    let committed: string | null = null
    const ti = new TextInput({
      mode: 'single',
      onSubmit: (v) => { committed = v },
    })
    // Type "hello world"
    ti.insert('hello world')
    expect(ti.getValue()).toBe('hello world')
    expect(ti.getCursor()).toBe(11)

    // Cmd+Left to start of line
    ti.handleKey('home')
    expect(ti.getCursor()).toBe(0)

    // Opt+Right (word jump) → after "hello"
    ti.handleKey('word-right')
    expect(ti.getCursor()).toBe(5)

    // Insert ", "
    ti.insert(', ')
    expect(ti.getValue()).toBe('hello,  world')

    // Opt+Backspace to kill the word "hello"
    ti.handleKey('home')
    ti.handleKey('word-right')
    expect(ti.getCursor()).toBe(5)
    ti.handleKey('kill-word-back')
    expect(ti.getValue()).toBe(',  world')

    // Submit
    ti.handleKey('enter')
    expect(committed).toBe(',  world')
  })

  test('simulate multi-line entry with newline + cursor moves', () => {
    const ti = new TextInput({ mode: 'multi' })
    ti.insert('first line')
    ti.handleKey('shift-enter')
    ti.insert('second line')
    expect(ti.getValue()).toBe('first line\nsecond line')
    // cursor at end of "second line" (position 22)
    expect(ti.getCursor()).toBe(22)
    // Up to "first line", same col
    ti.handleKey('up')
    expect(ti.getCursor()).toBe(10) // end of "first line"
  })
})

describe('helper utilities', () => {
  test('lineStart / lineEnd', () => {
    const t = 'aaa\nbbb\nccc'
    expect(lineStart(t, 0)).toBe(0)
    expect(lineStart(t, 5)).toBe(4)
    expect(lineStart(t, 9)).toBe(8)
    expect(lineEnd(t, 0)).toBe(3)
    expect(lineEnd(t, 4)).toBe(7)
    expect(lineEnd(t, 9)).toBe(11)
  })

  test('wordBoundaryLeft skips trailing spaces', () => {
    expect(wordBoundaryLeft('foo bar   ', 10)).toBe(4)
  })

  test('wordBoundaryRight skips leading spaces', () => {
    expect(wordBoundaryRight('   foo', 0)).toBe(6)
  })
})
