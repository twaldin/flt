import { describe, it, expect } from 'bun:test'
import { Screen, ATTR_BOLD } from '../../../src/tui/screen'

class MockWriter {
  chunks: string[] = []

  write(chunk: string): void {
    this.chunks.push(chunk)
  }
}

describe('screen', () => {
  it('flushes only changed cells and skips unchanged frames', () => {
    const writer = new MockWriter()
    const screen = new Screen(4, 2, writer, false)

    screen.put(0, 0, 'AB', '31', '', ATTR_BOLD)
    screen.flush()

    expect(writer.chunks.length).toBe(1)
    expect(writer.chunks[0]).toContain('\x1b[1;1H')
    expect(writer.chunks[0]).toContain('AB')

    writer.chunks = []
    screen.flush()
    expect(writer.chunks.length).toBe(0)

    screen.put(0, 1, 'Z', '32')
    screen.flush()

    expect(writer.chunks.length).toBe(1)
    expect(writer.chunks[0]).toContain('\x1b[1;2H')
    expect(writer.chunks[0]).toContain('Z')
  })

  it('resizes and forces full redraw on next flush', () => {
    const writer = new MockWriter()
    const screen = new Screen(3, 1, writer, false)

    screen.put(0, 0, 'abc')
    screen.flush()

    writer.chunks = []
    screen.resize(3, 1)
    screen.flush()

    expect(writer.chunks.length).toBe(1)
    expect(writer.chunks[0]).toContain('\x1b[1;1H')
  })

  it('writes ansi content into a region', () => {
    const writer = new MockWriter()
    const screen = new Screen(5, 2, writer, false)

    screen.putAnsi(0, 0, 5, 1, '\x1b[31mR\x1b[0mX')

    expect(screen.back[0][0].char).toBe('R')
    expect(screen.back[0][0].fg).toBe('31')
    expect(screen.back[0][1].char).toBe('X')
    expect(screen.back[0][1].fg).toBe('')
  })
})
