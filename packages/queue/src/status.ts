import { redis } from './client'

const PROCESSED_TTL_SECONDS = 60 * 60 * 24 * 7

function processedKey(stream: string, group: string) {
  return `${stream}:${group}:processed`
}

/** Record that a job was processed and acked successfully. */
export async function markJobProcessed(
  stream: string,
  group: string,
  jobId: string,
  consumerName: string,
): Promise<void> {
  const key = processedKey(stream, group)
  await redis.multi()
    .hset(key, jobId, JSON.stringify({ consumer: consumerName, completedAt: new Date().toISOString() }))
    .expire(key, PROCESSED_TTL_SECONDS)
    .exec()
}

/** All processed job ids with their completion info (recent jobs only, 7 day TTL). */
export async function listProcessedJobs(
  stream: string,
  group: string,
): Promise<Record<string, string>> {
  return redis.hgetall(processedKey(stream, group))
}
