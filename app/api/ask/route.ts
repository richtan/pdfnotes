import { getGemini, TEXT_MODEL, VISION_MODEL } from '@/app/lib/gemini';
import { NextRequest } from 'next/server';
import type { Content, Part } from '@google/genai';

interface SelectionContext {
  type: 'text' | 'area';
  text?: string;
  imageBase64?: string;
  pageNumber: number;
}

interface ChatMessageWithSelections {
  role: 'user' | 'assistant';
  content: string;
  selections?: SelectionContext[];  // Selections attached to this user message
}

// Legacy format for backward compatibility
interface LegacyContext {
  type: 'text' | 'area';
  text?: string;
  imageBase64?: string;
  pageNumber: number;
}

/** Strip data URI prefix if present, returning raw base64 */
function stripDataUri(base64: string): string {
  if (base64.startsWith('data:')) {
    return base64.split(',')[1] ?? base64;
  }
  return base64;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      question: string;
      // New multi-context format (flat array for backward compat)
      contexts?: LegacyContext[];
      // Legacy single-context format (for backward compatibility)
      context?: string;
      imageBase64?: string;
      // Conversation history with per-message selections
      conversationHistory?: ChatMessageWithSelections[];
    };

    const { question, conversationHistory = [] } = body;

    // Extract all selections from conversation history (per-message selections)
    const selectionsFromHistory: SelectionContext[] = [];
    for (const msg of conversationHistory) {
      if (msg.role === 'user' && msg.selections) {
        selectionsFromHistory.push(...msg.selections);
      }
    }

    // Normalize to contexts array (support multiple formats)
    let contexts: SelectionContext[] = [];

    // First, add any selections from conversation history
    contexts.push(...selectionsFromHistory);

    // Then add any flat contexts (backward compat)
    if (body.contexts && body.contexts.length > 0) {
      contexts.push(...body.contexts);
    } else if (body.context || body.imageBase64) {
      // Legacy format - convert to single context
      contexts.push({
        type: body.imageBase64 ? 'area' : 'text',
        text: body.context,
        imageBase64: body.imageBase64,
        pageNumber: 1,
      });
    }

    // Deduplicate contexts by creating a unique key
    const seen = new Set<string>();
    contexts = contexts.filter(ctx => {
      const key = `${ctx.type}-${ctx.pageNumber}-${ctx.text || ''}-${ctx.imageBase64?.slice(0, 50) || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!question) {
      return Response.json({ error: 'Question is required' }, { status: 400 });
    }

    if (contexts.length === 0) {
      return Response.json({ error: 'At least one context is required' }, { status: 400 });
    }

    const ai = getGemini();

    // Check if any context has an image
    const hasImages = contexts.some(ctx => ctx.imageBase64);
    const textContexts = contexts.filter(ctx => ctx.type === 'text' && ctx.text);
    const imageContexts = contexts.filter(ctx => ctx.type === 'area' && ctx.imageBase64);

    // System instruction
    const systemInstruction = contexts.length === 1
      ? (hasImages
          ? 'You are a helpful AI assistant analyzing a portion of a PDF document. The user has selected a region from the document. Provide clear, concise answers based on the image and conversation context.'
          : 'You are a helpful AI assistant analyzing text from a PDF document. Provide clear, concise, and accurate answers based on the provided context.')
      : 'You are a helpful AI assistant analyzing multiple selections from a PDF document. The user has selected several parts of the document. Provide clear, concise answers considering all the provided contexts together.';

    // Build context parts (Gemini Part[] format)
    const buildContextParts = (): Part[] => {
      const parts: Part[] = [];

      if (contexts.length === 1) {
        const ctx = contexts[0];
        if (ctx.type === 'text' && ctx.text) {
          parts.push({ text: `Context from the PDF (page ${ctx.pageNumber}):\n"${ctx.text}"` });
        } else if (ctx.imageBase64) {
          parts.push({ text: `Selected region from page ${ctx.pageNumber}:` });
          parts.push({
            inlineData: {
              mimeType: 'image/png',
              data: stripDataUri(ctx.imageBase64),
            },
          });
        }
      } else {
        // Multiple contexts
        let textDescription = 'The user has selected multiple parts from the PDF:\n\n';

        // Add text contexts
        textContexts.forEach((ctx, index) => {
          textDescription += `[Selection ${index + 1}] (page ${ctx.pageNumber}, text):\n"${ctx.text}"\n\n`;
        });

        // Add description for image contexts
        imageContexts.forEach((ctx, index) => {
          textDescription += `[Selection ${textContexts.length + index + 1}] (page ${ctx.pageNumber}, screenshot): See image below\n\n`;
        });

        parts.push({ text: textDescription.trim() });

        // Add actual images
        for (const ctx of imageContexts) {
          if (ctx.imageBase64) {
            parts.push({
              inlineData: {
                mimeType: 'image/png',
                data: stripDataUri(ctx.imageBase64),
              },
            });
          }
        }
      }

      return parts;
    };

    // Build Gemini contents array
    const contents: Content[] = [];

    if (conversationHistory.length === 0) {
      // First message - include full context with question
      const contextParts = buildContextParts();
      contextParts.push({ text: `\n\nQuestion: ${question}` });

      contents.push({
        role: 'user',
        parts: contextParts,
      });
    } else {
      // Follow-up message - context already in first exchange, just send summary + history
      const textSummary = textContexts.map((ctx, i) =>
        `[Context ${i + 1}, page ${ctx.pageNumber}]: "${ctx.text?.slice(0, 100)}..."`
      ).join('\n');
      if (textSummary) {
        contents.push({ role: 'user', parts: [{ text: `Reference context:\n${textSummary}` }] });
        contents.push({ role: 'model', parts: [{ text: 'I understand the context. How can I help?' }] });
      }

      // Truncate to last 20 messages to avoid token limits
      const recentHistory = conversationHistory.slice(-20);
      for (const msg of recentHistory) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }

      // Add the new question
      contents.push({
        role: 'user',
        parts: [{ text: question }],
      });
    }

    const stream = await ai.models.generateContentStream({
      model: hasImages ? VISION_MODEL : TEXT_MODEL,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: 1024,
      },
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.text;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
        } catch (error) {
          controller.enqueue(encoder.encode('\n\n[Error: Response was interrupted]'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Error in ask API:', error);
    return Response.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
