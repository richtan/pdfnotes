import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGenerateContentStream = vi.fn();
vi.mock('@/app/lib/gemini', () => ({
  getGemini: () => ({
    models: { generateContentStream: mockGenerateContentStream },
  }),
  TEXT_MODEL: 'gemini-3-flash-preview',
  VISION_MODEL: 'gemini-3-flash-preview',
}));

vi.mock('@/app/lib/rate-limit', () => ({
  createRateLimiter: () => () => ({ allowed: true, remaining: 9, resetInMs: 60000 }),
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  const json = JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/ask', {
    method: 'POST',
    body: json,
    headers: { 'Content-Type': 'application/json', 'content-length': String(json.length) },
  });
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

describe('POST /api/ask edge cases', () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../route');
    POST = mod.POST;
  });

  it('same context on different pages is NOT deduped', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    const res = await POST(makeRequest({
      question: 'test',
      contexts: [
        { type: 'text', text: 'same text', pageNumber: 1 },
        { type: 'text', text: 'same text', pageNumber: 2 },
      ],
    }));
    expect(res.status).toBe(200);

    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('multiple selections');
  });

  it('handles missing conversationHistory gracefully', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    const res = await POST(makeRequest({
      question: 'test',
      contexts: [{ type: 'text', text: 'ctx', pageNumber: 1 }],
      // no conversationHistory field
    }));
    expect(res.status).toBe(200);
  });

  it('history exactly 20 messages is not truncated', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));

    const res = await POST(makeRequest({
      question: 'follow-up',
      contexts: [{ type: 'text', text: 'ctx', pageNumber: 1 }],
      conversationHistory: history,
    }));
    expect(res.status).toBe(200);

    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    // Should contain all 20 messages + context summary + model ack + new question
    const userContents = callArgs.contents.filter((c: { role: string }) => c.role === 'user');
    expect(userContents.length).toBeGreaterThanOrEqual(11); // 10 user msgs from history + context + question
  });

  it('uses single-context system instruction for 1 context', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    await POST(makeRequest({
      question: 'test',
      contexts: [{ type: 'text', text: 'single ctx', pageNumber: 1 }],
    }));

    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('text from a PDF');
    expect(callArgs.config.systemInstruction).not.toContain('multiple');
  });

  it('uses multi-context system instruction for 2+ contexts', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    await POST(makeRequest({
      question: 'test',
      contexts: [
        { type: 'text', text: 'a', pageNumber: 1 },
        { type: 'text', text: 'b', pageNumber: 2 },
      ],
    }));

    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('multiple selections');
  });

  it('legacy context field works', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    const res = await POST(makeRequest({
      question: 'test',
      context: 'legacy text',
    }));
    expect(res.status).toBe(200);
  });

  it('legacy imageBase64 field creates area context', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () { yield { text: 'ok' }; },
    });

    const res = await POST(makeRequest({
      question: 'test',
      imageBase64: 'data:image/png;base64,abc',
    }));
    expect(res.status).toBe(200);

    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('selected a region');
  });
});
