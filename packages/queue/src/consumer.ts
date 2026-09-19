import { randomUUID } from 'node:crypto'
import { redis } from './client'
import type { ConsumerGroupName, ConsumerName, JobHandler, JobPayload, StreamName } from './types'

type StreamEntry = [id: string, fields: string[]]

type XReadGroupReply = [streamName: string, entries: StreamEntry[]][]

export interface ConsumeOptions {
  consumerName?: ConsumerName
  batchSize?: number
  blockMs?: number
  signal?: AbortSignal
}

async function ensureGroup(stream: StreamName, group: ConsumerGroupName) {
  try {
    await redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM')
  } catch (err: any) {
    if (!err.message.includes('BUSYGROUP')) throw err
  }
}

function arrayToObject(fields: string[]): JobPayload {
  // XREADGROUP returns fields as a flat [key, value, key, value, ...] list,
  // so the count is always even and the pair is never undefined
  const obj: JobPayload = {}
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]!] = fields[i + 1]!
  }
  return obj
}

export async function consume(
  stream: StreamName,
  group: ConsumerGroupName,
  handler: JobHandler,
  options: ConsumeOptions = {}
): Promise<void> {
  await ensureGroup(stream, group)

  const consumerName =
    options.consumerName ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`
  const batchSize = options.batchSize ?? 10
  const blockMs = options.blockMs ?? 5000

  while (!options.signal?.aborted) {
    const results = (await redis.xreadgroup(
      'GROUP', group, consumerName,
      'COUNT', batchSize,
      'BLOCK', blockMs,
      'STREAMS', stream, '>'
    )) as XReadGroupReply | null

    if (!results) continue // timed out, no new entries — loop again

    const first = results[0]
    if (!first) continue

    const [, entries] = first

    for (const [id, fields] of entries) {
      const payload = arrayToObject(fields)
      try {
        await handler(id, payload)
        await redis.xack(stream, group, id)
      } catch (err) {
        console.error(`Handler failed for ${id}:`, err)
        // deliberately not acking — stays in the PEL so it can be retried/reclaimed later
      }
    }
  }
}