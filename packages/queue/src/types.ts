export type StreamName = string

export type ConsumerGroupName = string

export type ConsumerName = string

export type JobPayload = Record<string, string>

export type JobHandler = (id: string, payload: JobPayload) => Promise<void>