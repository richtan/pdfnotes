import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGenerateContent = vi.fn();
vi.mock('@/app/lib/gemini', () => ({
  getGemini: () => ({
    models: {
      generateContent: mockGenerateContent,
    },
  }),
  TEXT_MODEL: 'gemini-3-flash-preview',
}));

vi.mock('@/app/lib/rate-limit', () => ({
  createRateLimiter: () => () => ({ allowed: true, remaining: 19, resetInMs: 60000 }),
}));

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  const json = JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/generate-title', {
    method: 'POST',
    body: json,
    headers: {
      'Content-Type': 'application/json',
      'content-length': String(json.length),
      ...headers,
    },
  });
}

describe('POST /api/generate-title', () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../route');
    POST = mod.POST;
  });

  it('returns 400 when messages are empty', async () => {
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when messages are missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 413 when body is too large', async () => {
    const req = new NextRequest('http://localhost:3000/api/generate-title', {
      method: 'POST',
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'content-length': String(51 * 1024), // 51KB > 50KB limit
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('generates a title successfully', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'PDF Analysis Summary' });

    const res = await POST(makeRequest({
      messages: [
        { role: 'user', content: 'What is this about?' },
        { role: 'assistant', content: 'This is about...' },
      ],
      context: 'Some PDF text',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('PDF Analysis Summary');
  });

  it('trims whitespace from generated title', async () => {
    mockGenerateContent.mockResolvedValue({ text: '  Title With Spaces  ' });

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
    }));

    const body = await res.json();
    expect(body.title).toBe('Title With Spaces');
  });

  it('returns empty string when API returns no text', async () => {
    mockGenerateContent.mockResolvedValue({ text: null });

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
    }));

    const body = await res.json();
    expect(body.title).toBe('');
  });

  it('returns 500 on Gemini API error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'));

    const res = await POST(makeRequest({
      messages: [{ role: 'user', content: 'q' }],
    }));

    expect(res.status).toBe(500);
  });

  it('includes context in the prompt when provided', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Title' });

    await POST(makeRequest({
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
      context: 'Important PDF context here',
    }));

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.contents).toContain('Important PDF context here');
  });

  it('truncates message content to 200 chars in summary', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Title' });
    const longContent = 'x'.repeat(300);

    await POST(makeRequest({
      messages: [{ role: 'user', content: longContent }],
    }));

    const callArgs = mockGenerateContent.mock.calls[0][0];
    // The conversation summary should have truncated content
    expect(callArgs.contents.length).toBeLessThan(longContent.length);
  });
});
