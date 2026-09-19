import Redis from 'ioredis'

const url = process.env.REDIS_URL ?? 'redis://localhost:6379'

export const redis = new Redis(url, {
  // a blocking consumer must be allowed to keep a request in flight indefinitely,
  // otherwise ioredis aborts xreadgroup's BLOCK after 20 failed retries
  maxRetriesPerRequest: null,
})

redis.on('error', (err) => {
  console.error('redis error:', err)
})