import { randomUUID } from 'node:crypto'
import { redis } from './client'
import { arrayToObject } from './fields'
import type { ConsumerGroupName, ConsumerName, JobHandler, StreamName } from './types'

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
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM')
  } catch (err: any) {
    if (!err.message.includes('BUSYGROUP')) throw err
  }
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

  const processEntry = async (id: string, fields: string[]) => {
    const payload = arrayToObject(fields)
    try {
      await handler(id, payload)
      await redis.xack(stream, group, id)
    } catch (err) {
      console.error(`Handler failed for ${id}:`, err)
      // deliberately not acking — stays in the PEL so it can be retried/reclaimed later
    }
  }

  // Recover jobs that were in flight when a previous consumer died: entries this
  // consumer name already owns sit in the PEL and are never delivered again by '>' .
  // Read them with ID 0 and reprocess before entering the normal loop.
  if (!options.signal?.aborted) {
    const pending = (await redis.xreadgroup(
      'GROUP', group, consumerName,
      'COUNT', batchSize,
      'STREAMS', stream, '0'
    )) as XReadGroupReply | null

    for (const [, entries] of pending ?? []) {
      for (const [id, fields] of entries) {
        await processEntry(id, fields)
      }
    }
  }

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
      await processEntry(id, fields)
    }
  }
}