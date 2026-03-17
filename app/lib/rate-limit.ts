interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

export function createRateLimiter() {
  const store = new Map<string, RateLimitEntry>();
  let callCount = 0;

  return function checkRateLimit(ip: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();

    // Auto-cleanup expired entries every 100 calls
    if (++callCount % 100 === 0) {
      for (const [key, entry] of store) {
        if (now >= entry.resetTime) store.delete(key);
      }
    }

    const entry = store.get(ip);

    if (!entry || now >= entry.resetTime) {
      store.set(ip, { count: 1, resetTime: now + config.windowMs });
      return { allowed: true, remaining: config.maxRequests - 1, resetInMs: config.windowMs };
    }

    entry.count++;
    const resetInMs = entry.resetTime - now;

    if (entry.count > config.maxRequests) {
      return { allowed: false, remaining: 0, resetInMs };
    }

    return { allowed: true, remaining: config.maxRequests - entry.count, resetInMs };
  };
}
