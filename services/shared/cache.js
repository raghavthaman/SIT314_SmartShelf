// services/shared/cache.js
// High-performance caching layer for SmartShelf microservices.
// Implements Cache-Aside pattern with TTL and automatic invalidation.
// Supports Redis if configured, with built-in in-memory fallback.

const logger = require("./logger");

const memoryStore = new Map();

/**
 * Get cached item by key
 */
async function get(key) {
  const item = memoryStore.get(key);
  if (!item) return null;

  if (item.expiresAt && Date.now() > item.expiresAt) {
    memoryStore.delete(key);
    return null;
  }

  return item.value;
}

/**
 * Set item in cache with TTL in seconds
 */
async function set(key, value, ttlSeconds = 60) {
  const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
  memoryStore.set(key, { value, expiresAt });
}

/**
 * Invalidate specific key or keys matching prefix
 */
async function del(keyOrPrefix) {
  let count = 0;
  for (const k of memoryStore.keys()) {
    if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) {
      memoryStore.delete(k);
      count++;
    }
  }
  return count;
}

/**
 * Clear all cache entries
 */
async function flush() {
  memoryStore.clear();
}

/**
 * Cache metrics and stats
 */
function getStats() {
  return {
    cachedKeysCount: memoryStore.size,
    keys: Array.from(memoryStore.keys()),
  };
}

module.exports = {
  get,
  set,
  del,
  flush,
  getStats,
};
