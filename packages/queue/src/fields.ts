import type { JobPayload } from './types'

// XREADGROUP and XAUTOCLAIM both return fields as a flat [key, value, key, value, ...] list,
// so the count is always even and the pair is never undefined
export function arrayToObject(fields: string[]): JobPayload {
  const obj: JobPayload = {}
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]!] = fields[i + 1]!
  }
  return obj
}