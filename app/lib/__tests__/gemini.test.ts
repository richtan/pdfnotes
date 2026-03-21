import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock before importing
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: {} })),
}));

describe('gemini', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports TEXT_MODEL as gemini-3-flash-preview', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const { TEXT_MODEL } = await import('../gemini');
    expect(TEXT_MODEL).toBe('gemini-3-flash-preview');
    vi.unstubAllEnvs();
  });

  it('exports VISION_MODEL as gemini-3-flash-preview', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const { VISION_MODEL } = await import('../gemini');
    expect(VISION_MODEL).toBe('gemini-3-flash-preview');
    vi.unstubAllEnvs();
  });

  it('throws when GEMINI_API_KEY is missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { getGemini } = await import('../gemini');
    expect(() => getGemini()).toThrow('GEMINI_API_KEY');
    vi.unstubAllEnvs();
  });

  it('returns a GoogleGenAI instance when key is set', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key-123');
    const { getGemini } = await import('../gemini');
    const client = getGemini();
    expect(client).toBeDefined();
    expect(client.models).toBeDefined();
    vi.unstubAllEnvs();
  });
});
