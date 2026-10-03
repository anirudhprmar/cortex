import { redis, publish, reclaim } from './src/index'

const STREAM = 'reclaim-jobs'
const GROUP = 'reclaim-workers'

await redis.del(STREAM, `${STREAM}:${GROUP}:retries`) // clean slate so reruns are deterministic

await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM')

// simulate a consumer that read the job and then died without acking it
const read = (await redis.xreadgroup(
  'GROUP', GROUP, 'doomed-consumer',
  'COUNT', 1,
  'STREAMS', STREAM, '>'
)) as [[string, [[string, string[]]]][]] | null

const stuckId = read![0]![1]![0]![0]
console.log('stuck in the PEL:', stuckId)

let attempts = 0
const summary = await reclaim(
  STREAM,
  GROUP,
  async () => {
    attempts++
    throw new Error('handler always fails')
  },
  { minIdleTime: 0, maxRetries: 3 }
)

console.log('summary:', summary)
console.log('handler invocations:', attempts)

const pending = (await redis.xpending(STREAM, GROUP, '-', '+', 10)) as unknown[]
const retries = await redis.hgetall(`${STREAM}:${GROUP}:retries`)
console.log('pending after reclaim:', pending)
console.log('retry hash after reclaim:', retries, '(should be empty)')

await redis.quit()

if (pending.length !== 0) throw new Error(`expected empty PEL, got ${pending.length} pending`)
if (summary.deadLettered !== 1) throw new Error(`expected 1 dead-letter, got ${summary.deadLettered}`)
if (Object.keys(retries).length !== 0) throw new Error('retry hash was not cleaned up')

console.log('ok')