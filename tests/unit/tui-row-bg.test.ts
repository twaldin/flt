import { describe, expect, it } from 'bun:test'
import { putSeparatedRow as putGatesSeparatedRow } from '../../src/tui/modal-gates'
import { putSeparatedRow as putWorkflowSeparatedRow } from '../../src/tui/modal-workflows'
import { ATTR_INVERSE, Screen } from '../../src/tui/screen'

interface PutCall {
  row: number
  col: number
  text: string
  fg: string
  bg: string
  attrs: number
}

function separatorAttrsFrom(
  renderRow: (screen: Screen) => void,
): number {
  const screen = new Screen(
    40,
    2,
    { write: (_chunk: string): void => {} },
    false,
  )

  const calls: PutCall[] = []
  const originalPut = screen.put.bind(screen)
  screen.put = (row, col, text, fg = '', bg = '', attrs = 0): void => {
    calls.push({ row, col, text, fg, bg, attrs })
    originalPut(row, col, text, fg, bg, attrs)
  }

  renderRow(screen)

  const separatorCall = calls.find(call => call.text === ' │ ')
  expect(separatorCall).toBeDefined()
  return separatorCall?.attrs ?? 0
}

describe('tui selected-row separator attrs', () => {
  it('propagates ATTR_INVERSE for workflow modal separators', () => {
    const attrs = separatorAttrsFrom((screen) => {
      putWorkflowSeparatedRow(screen, 0, 0, [4, 4], ['aaaa', 'bbbb'], '#fff', '#888', '', ATTR_INVERSE)
    })
    expect((attrs & ATTR_INVERSE) !== 0).toBeTrue()
  })

  it('propagates ATTR_INVERSE for gates modal separators', () => {
    const attrs = separatorAttrsFrom((screen) => {
      putGatesSeparatedRow(screen, 0, 0, [4, 4], ['aaaa', 'bbbb'], '#fff', '#888', '', ATTR_INVERSE)
    })
    expect((attrs & ATTR_INVERSE) !== 0).toBeTrue()
  })
})
