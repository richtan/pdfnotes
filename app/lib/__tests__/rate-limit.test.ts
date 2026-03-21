import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter } from '../rate-limit';

describe('createRateLimiter', () => {
  let checkRateLimit: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    checkRateLimit = createRateLimiter();
  });

  it('allows requests under the limit', () => {
    const result = checkRateLimit('1.2.3.4', { maxRequests: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('decrements remaining on each request', () => {
    checkRateLimit('1.2.3.4', { maxRequests: 3, windowMs: 60_000 });
    const result = checkRateLimit('1.2.3.4', { maxRequests: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('allows the request at maxRequests (remaining=0)', () => {
    const config = { maxRequests: 2, windowMs: 60_000 };
    checkRateLimit('ip', config);
    const result = checkRateLimit('ip', config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('blocks requests exceeding the limit', () => {
    const config = { maxRequests: 2, windowMs: 60_000 };
    checkRateLimit('ip', config);
    checkRateLimit('ip', config);
    const result = checkRateLimit('ip', config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns correct resetInMs', () => {
    const config = { maxRequests: 1, windowMs: 30_000 };
    const result = checkRateLimit('ip', config);
    expect(result.resetInMs).toBe(30_000);
  });

  it('tracks IPs independently', () => {
    const config = { maxRequests: 1, windowMs: 60_000 };
    checkRateLimit('ip-a', config);
    checkRateLimit('ip-a', config); // blocked

    const result = checkRateLimit('ip-b', config);
    expect(result.allowed).toBe(true);
  });

  it('resets after window expires', () => {
    vi.useFakeTimers();
    const config = { maxRequests: 1, windowMs: 1_000 };

    checkRateLimit('ip', config);
    expect(checkRateLimit('ip', config).allowed).toBe(false);

    vi.advanceTimersByTime(1_001);

    expect(checkRateLimit('ip', config).allowed).toBe(true);
    vi.useRealTimers();
  });

  it('handles unknown IP', () => {
    const result = checkRateLimit('unknown', { maxRequests: 5, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
  });

  it('cleans up expired entries after 100 calls', () => {
    vi.useFakeTimers();
    const config = { maxRequests: 1, windowMs: 100 };

    // Create entries from many IPs
    for (let i = 0; i < 50; i++) {
      checkRateLimit(`ip-${i}`, config);
    }

    // Advance past window
    vi.advanceTimersByTime(200);

    // Make more calls to trigger cleanup (every 100 calls)
    for (let i = 50; i < 100; i++) {
      checkRateLimit(`ip-${i}`, config);
    }

    // After cleanup, expired entries should be gone — original IPs should be allowed again
    expect(checkRateLimit('ip-0', config).allowed).toBe(true);
    vi.useRealTimers();
  });
});
