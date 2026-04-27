export function workflowLabel(value: string | undefined): string {
  return (value ?? '').trim()
}

export function shouldRenderWorkflowRow(value: string | undefined): boolean {
  return workflowLabel(value).length > 0
}

export function sidebarEntryRows(value: string | undefined): number {
  return shouldRenderWorkflowRow(value) ? 6 : 5
}
