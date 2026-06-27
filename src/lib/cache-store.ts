"use client"

type CacheEntry<T> = {
  data: T
  timestamp: number
}

const cacheStore = new Map<string, CacheEntry<unknown>>()

export const localCache = {
  get: <T>(key: string, ttlMs: number = 30000): T | null => {
    if (typeof window === "undefined") return null
    const entry = cacheStore.get(key)
    if (!entry) return null
    const isExpired = Date.now() - entry.timestamp > ttlMs
    if (isExpired) {
      cacheStore.delete(key)
      return null
    }
    return entry.data as T
  },
  set: <T>(key: string, data: T): void => {
    if (typeof window === "undefined") return
    cacheStore.set(key, { data, timestamp: Date.now() })
  },
  delete: (key: string): void => {
    cacheStore.delete(key)
  },
  clear: (): void => {
    cacheStore.clear()
  },
}
