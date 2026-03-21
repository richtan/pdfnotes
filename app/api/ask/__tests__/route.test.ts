import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Gemini SDK
const mockGenerateContentStream = vi.fn();
vi.mock('@/app/lib/gemini', () => ({
  getGemini: () => ({
    models: {
      generateContentStream: mockGenerateContentStream,
    },
  }),
  TEXT_MODEL: 'gemini-3-flash-preview',
  VISION_MODEL: 'gemini-3-flash-preview',
}));

// Mock rate limiter to always allow
vi.mock('@/app/lib/rate-limit', () => ({
  createRateLimiter: () => () => ({ allowed: true, remaining: 9, resetInMs: 60000 }),
}));

// Helper to create a NextRequest
function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  const json = JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/ask', {
    method: 'POST',
    body: json,
    headers: {
      'Content-Type': 'application/json',
      'content-length': String(json.length),
      ...headers,
    },
  });
}

// Helper to read a streaming response to string
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
  result += decoder.decode();
  return result;
}

describe('POST /api/ask', () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get fresh module with mocks
    const mod = await import('../route');
    POST = mod.POST;
  });

  it('returns 400 when question is missing', async () => {
    const req = makeRequest({
      contexts: [{ type: 'text', text: 'some context', pageNumber: 1 }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Question is required');
  });

  it('returns 400 when no contexts provided', async () => {
    const req = makeRequest({ question: 'What is this?' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('context');
  });

  it('returns 413 when body is too large', async () => {
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'content-length': String(11 * 1024 * 1024), // 11MB
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('streams response for text context', async () => {
    // Mock Gemini streaming response
    const chunks = [
      { text: 'Hello' },
      { text: ' world' },
      { text: '!' },
    ];
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
    });

    const req = makeRequest({
      question: 'What does this say?',
      contexts: [{ type: 'text', text: 'Hello world', pageNumber: 1 }],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');

    const text = await readStream(res);
    expect(text).toBe('Hello world!');
  });

  it('handles image context', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { text: 'I see an image' };
      },
    });

    const req = makeRequest({
      question: 'What is in this image?',
      contexts: [{ type: 'area', imageBase64: 'data:image/png;base64,abc123', pageNumber: 1 }],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify the model was called with the image
    expect(mockGenerateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-flash-preview',
      }),
    );
  });

  it('deduplicates identical contexts', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { text: 'response' };
      },
    });

    const req = makeRequest({
      question: 'test',
      contexts: [
        { type: 'text', text: 'same text', pageNumber: 1 },
        { type: 'text', text: 'same text', pageNumber: 1 }, // duplicate
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should have been called with single-context system instruction
    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('text from a PDF');
  });

  it('does NOT deduplicate contexts on different pages', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { text: 'response' };
      },
    });

    const req = makeRequest({
      question: 'test',
      contexts: [
        { type: 'text', text: 'same text', pageNumber: 1 },
        { type: 'text', text: 'same text', pageNumber: 2 }, // different page
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should have been called with multi-context system instruction
    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain('multiple selections');
  });

  it('truncates conversation history to 20 messages', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { text: 'response' };
      },
    });

    // Create 30 messages
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    const req = makeRequest({
      question: 'follow up',
      contexts: [{ type: 'text', text: 'context', pageNumber: 1 }],
      conversationHistory: history,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify contents array doesn't include all 30 messages
    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    // Context summary (1) + model ack (1) + last 20 history + new question (1) = 23
    expect(callArgs.contents.length).toBeLessThanOrEqual(25);
  });

  it('appends error message when stream fails', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { text: 'partial' };
        throw new Error('Stream interrupted');
      },
    });

    const req = makeRequest({
      question: 'test',
      contexts: [{ type: 'text', text: 'context', pageNumber: 1 }],
    });

    const res = await POST(req);
    const text = await readStream(res);
    expect(text).toContain('partial');
    expect(text).toContain('[Error: Response was interrupted]');
  });

  it('handles legacy context format', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { text: 'response' };
      },
    });

    const req = makeRequest({
      question: 'test',
      context: 'legacy text context', // legacy format
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 500 on Gemini API error', async () => {
    mockGenerateContentStream.mockRejectedValue(new Error('API quota exceeded'));

    const req = makeRequest({
      question: 'test',
      contexts: [{ type: 'text', text: 'context', pageNumber: 1 }],
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
