import { redis } from './client'
import type { JobPayload, StreamName } from './types'

export interface PublishOptions {
  id?: string
  maxLen?: number
}

export async function publish(
  stream: StreamName,
  payload: JobPayload,
  options: PublishOptions = {}
): Promise<string> {
  const args: (string | number)[] = []

  if (options.maxLen !== undefined) {
    args.push('MAXLEN', '~', options.maxLen)
  }

  args.push(options.id ?? '*')

  for (const [key, value] of Object.entries(payload)) {
    args.push(key, value)
  }

  const id = await redis.xadd(stream, ...args)
  if (id === null) {
    throw new Error(`xadd to "${stream}" returned no id`)
  }
  return id
}