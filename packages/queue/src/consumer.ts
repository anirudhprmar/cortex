import { redis } from './client'

type JobHandler = (id: string, fields: Record<string, string>) => Promise<void>

const CONSUMER_NAME = `worker-${process.pid}`

async function ensureGroup(stream: string, group: string) {
  try {
    await redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM')
  } catch (err: any) {
    if (!err.message.includes('BUSYGROUP')) throw err
    // group already exists — fine, no-op
  }
}

function arrayToObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1]
  }
  return obj
}

export async function consume(stream: string, group: string, handler: JobHandler) {
  await ensureGroup(stream, group)

  while (true) {
    const results = await redis.xreadgroup(
      'GROUP', group, CONSUMER_NAME,
      'COUNT', 10,
      'BLOCK', 5000,
      'STREAMS', stream, '>'
    )

    if (!results) continue // timed out, no new entries — loop again

    // results shape: [[streamName, [[id, fields], [id, fields], ...]]]
    const [[, entries]] = results as [string, [string, string[]][]][]

    for (const [id, fields] of entries) {
      const payload = arrayToObject(fields)
      try {
        await handler(id, payload)
        await redis.xack(stream, group, id)
      } catch (err) {
        console.error(`Handler failed for ${id}:`, err)
        // deliberately not acking — stays in PEL for retry logic later
      }
    }
  }
}

consume('index-jobs', 'index-workers', async (id, payload) => {
  console.log('Processing job', id, payload)
  // actual indexing logic goes here later
})
