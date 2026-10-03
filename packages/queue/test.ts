import { redis, publish, consume } from './src/index'

const STREAM = 'index-jobs'
const GROUP = 'index-workers'

await redis.del(STREAM) // clean slate so reruns are deterministic

const controller = new AbortController()
let processed = 0
let markDone: () => void
const done = new Promise<void>((resolve) => (markDone = resolve))

const running = consume(STREAM, GROUP, async (id, payload) => {
  console.log('processed', id, payload)
  processed++
  if (processed >= 2) {
    controller.abort()
    markDone()
  }
}, { signal: controller.signal })

await new Promise((r) => setTimeout(r, 500)) // let the group get created at '$'

await publish(STREAM, {
  type: 'decision',
  payload: JSON.stringify({ note: 'first job' }),
})
await publish(STREAM, {
  type: 'preference',
  payload: JSON.stringify({ note: 'second job' }),
})
console.log('published 2 jobs')

await done
await running
await redis.quit()
console.log('done')