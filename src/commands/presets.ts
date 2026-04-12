import { addPreset, listPresets, removePreset } from '../presets'

interface PresetsAddArgs {
  name: string
  cli: string
  model: string
  description?: string
}

interface PresetsRemoveArgs {
  name: string
}

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

export function formatPresetList(): string {
  const presets = listPresets()
  if (presets.length === 0) {
    return 'No presets found.'
  }

  const headers = ['name', 'cli', 'model', 'description']
  const rows = presets.map((preset) => [
    preset.name,
    preset.cli,
    preset.model,
    preset.description ?? '',
  ])

  const widths = headers.map((header, idx) =>
    Math.max(header.length, ...rows.map((row) => row[idx].length))
  )

  const lines = [
    headers.map((header, idx) => pad(header, widths[idx])).join('  '),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map((row) => row.map((value, idx) => pad(value, widths[idx])).join('  ')),
  ]

  return lines.join('\n')
}

export function presetsList(): void {
  if (!process.env.FLT_TUI_ACTIVE) {
    console.log(formatPresetList())
  }
}

export function presetsAdd(args: PresetsAddArgs): void {
  addPreset(args.name, {
    cli: args.cli,
    model: args.model,
    description: args.description,
  })
}

export function presetsRemove(args: PresetsRemoveArgs): void {
  if (!removePreset(args.name)) {
    throw new Error(`Preset "${args.name}" does not exist.`)
  }
}
