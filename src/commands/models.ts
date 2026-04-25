import { resolveModelForCli } from '../model-resolution'

interface ModelsResolveArgs {
  alias: string
  cli: string
  noResolve?: boolean
}

export function modelsResolve(args: ModelsResolveArgs): void {
  const { alias, cli, noResolve = false } = args
  const resolved = resolveModelForCli(cli, alias, noResolve) ?? alias

  if (noResolve) {
    console.log(`passthrough (${cli}): ${alias}`)
    return
  }

  if (resolved === alias) {
    console.log(`resolved (${cli}): ${resolved} (unchanged)`)
    return
  }

  console.log(`resolved (${cli}): ${alias} -> ${resolved}`)
}
