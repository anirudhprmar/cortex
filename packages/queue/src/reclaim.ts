import { randomUUID } from 'node:crypto'
import { redis } from './client'
import { arrayToObject } from './fields'
import type { ConsumerGroupName, ConsumerName, JobHandler, JobPayload, StreamName } from './types'

type StreamEntry = [id: string, fields: string[]]

type XAutoClaimReply = [nextCursor: string, messages: StreamEntry[], deletedIds: string[]]

const MAX_PAGES = 100

export interface DeadLetterEntry {
  stream: StreamName
  group: ConsumerGroupName
  id: string
  payload: JobPayload
  attempts: number
}

export interface ReclaimOptions {
  consumerName?: ConsumerName
  minIdleTime?: number
  maxRetries?: number
  count?: number
  onDeadLetter?: (entry: DeadLetterEntry) => Promise<void>
}

export interface ReclaimSummary {
  reclaimed: number
  succeeded: number
  failed: number
  deadLettered: number
  tombstonesAcked: number
}

function retriesKey(stream: StreamName, group: ConsumerGroupName): string {
  return `${stream}:${group}:retries`
}

async function getAttempts(key: string, id: string): Promise<number> {
  const raw = await redis.hget(key, id)
  const attempts = Number(raw ?? 0)
  return Number.isFinite(attempts) ? attempts : 0
}

export async function reclaim(
  stream: StreamName,
  group: ConsumerGroupName,
  handler: JobHandler,
  options: ReclaimOptions = {}
): Promise<ReclaimSummary> {
  const consumerName = options.consumerName ?? `reclaimer-${process.pid}-${randomUUID().slice(0, 8)}`
  const minIdleTime = options.minIdleTime ?? 30_000
  const maxRetries = options.maxRetries ?? 5
  const count = options.count ?? 10
  const key = retriesKey(stream, group)

  const summary: ReclaimSummary = {
    reclaimed: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    tombstonesAcked: 0,
  }

  let cursor = '0-0'
  let page = 0

  do {
    page++
    const [nextCursor, messages, deletedIds] = (await redis.xautoclaim(
      stream,
      group,
      consumerName,
      minIdleTime,
      cursor,
      'COUNT',
      count
    )) as XAutoClaimReply

    for (const tombstoneId of deletedIds ?? []) {
      await redis.xack(stream, group, tombstoneId)
      summary.tombstonesAcked++
    }

    for (const [id, fields] of messages ?? []) {
      summary.reclaimed++
      const payload = arrayToObject(fields)
      const attempts = await getAttempts(key, id)

      if (attempts >= maxRetries) {
        // TODO: insert into dead_letter_jobs in Postgres
        console.error(
          `Dead-lettering ${id} on "${stream}/${group}" after ${attempts} attempts`,
          payload
        )
        await options.onDeadLetter?.({ stream, group, id, payload, attempts })
        // ack last, so a failing dead-letter write leaves the entry in the PEL to retry
        await redis.xack(stream, group, id)
        await redis.hdel(key, id)
        summary.deadLettered++
        continue
      }

      await redis.hincrby(key, id, 1)

      try {
        await handler(id, payload)
        await redis.xack(stream, group, id)
        await redis.hdel(key, id)
        summary.succeeded++
      } catch (err) {
        summary.failed++
        console.error(`Reclaim attempt ${attempts + 1}/${maxRetries} failed for ${id}:`, err)
      }
    }

    cursor = nextCursor
  } while (cursor !== '0-0' && page < MAX_PAGES)

  return summary
}