import { listEvents } from '../activity'

interface ActivityArgs {
  limit?: number
  type?: string
  since?: string
}

export function activity(args: ActivityArgs): void {
  const events = listEvents({
    limit: args.limit ?? 20,
    type: args.type,
    since: args.since,
  })

  if (events.length === 0) {
    console.log('No activity recorded.')
    return
  }

  for (const event of events) {
    const d = new Date(event.at)
    const time = d.toLocaleDateString() + ' ' + d.toLocaleTimeString()
    const agent = event.agent ? ` [${event.agent}]` : ''
    console.log(`${time}  ${event.type}${agent}  ${event.detail}`)
  }
}
