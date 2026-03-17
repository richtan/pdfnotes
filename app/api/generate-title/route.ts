import { getGemini, TEXT_MODEL } from '@/app/lib/gemini';
import { createRateLimiter } from '@/app/lib/rate-limit';
import { NextRequest } from 'next/server';

const checkRateLimit = createRateLimiter();
const MAX_BODY_SIZE = 50 * 1024; // 50KB

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(request: NextRequest) {
  // Body size check
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    return Response.json({ error: 'Request body too large' }, { status: 413 });
  }

  // Rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  const { allowed, resetInMs } = checkRateLimit(ip, { maxRequests: 20, windowMs: 60_000 });
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(resetInMs / 1000)) } },
    );
  }

  try {
    const { messages, context } = await request.json() as {
      messages: ChatMessage[];
      context?: string;
    };

    if (!messages || messages.length === 0) {
      return Response.json({ error: 'Messages are required' }, { status: 400 });
    }

    const ai = getGemini();

    // Build a summary of the conversation for title generation
    const conversationSummary = messages
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: `${context ? `Context: "${context.slice(0, 200)}"\n\n` : ''}Conversation:\n${conversationSummary}`,
      config: {
        systemInstruction: 'Generate a very short title (3-6 words) that summarizes this conversation about a PDF document. Return only the title, no quotes or punctuation at the end.',
        maxOutputTokens: 20,
        temperature: 0.7,
      },
    });

    const title = response.text?.trim() || '';

    return Response.json({ title });
  } catch (error) {
    console.error('Error generating title:', error);
    return Response.json(
      { error: 'Failed to generate title' },
      { status: 500 }
    );
  }
}
