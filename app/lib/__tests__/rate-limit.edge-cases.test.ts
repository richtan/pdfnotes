import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter } from '../rate-limit';

describe('rate-limit edge cases', () => {
  it('cleanup triggers at exactly 100 calls', () => {
    vi.useFakeTimers();
    const checkRateLimit = createRateLimiter();
    const config = { maxRequests: 100, windowMs: 100 };

    // Make 99 calls from different IPs
    for (let i = 0; i < 99; i++) {
      checkRateLimit(`ip-${i}`, config);
    }

    // Advance time so all entries expire
    vi.advanceTimersByTime(200);

    // 100th call triggers cleanup
    checkRateLimit('ip-99', config);

    // Expired entries should be cleaned — ip-0 should be fresh
    const result = checkRateLimit('ip-0', config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
    vi.useRealTimers();
  });

  it('handles maxRequests=1 correctly', () => {
    const checkRateLimit = createRateLimiter();
    const config = { maxRequests: 1, windowMs: 60000 };

    expect(checkRateLimit('ip', config).allowed).toBe(true);
    expect(checkRateLimit('ip', config).allowed).toBe(false);
  });

  it('handles rapid requests from same IP', () => {
    const checkRateLimit = createRateLimiter();
    const config = { maxRequests: 3, windowMs: 60000 };

    // Fire 5 rapid requests
    const results = Array.from({ length: 5 }, () => checkRateLimit('ip', config));

    expect(results[0].allowed).toBe(true);
    expect(results[1].allowed).toBe(true);
    expect(results[2].allowed).toBe(true);
    expect(results[3].allowed).toBe(false);
    expect(results[4].allowed).toBe(false);
  });
});
