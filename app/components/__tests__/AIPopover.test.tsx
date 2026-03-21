import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIPopover } from '../AIPopover';
import type { Selection, ChatMessage } from '../../hooks/useSelection';

// Mock KaTeX CSS import
vi.mock('katex/dist/katex.min.css', () => ({}));

const makeSelection = (overrides: Partial<Selection> = {}): Selection => ({
  id: 'sel-1',
  type: 'text',
  text: 'test selection text',
  rect: new DOMRect(0, 0, 100, 20),
  pageNumber: 1,
  scale: 1,
  timestamp: Date.now(),
  ...overrides,
});

const defaultProps = {
  selections: [makeSelection()],
  onClose: vi.fn(),
  onMessagesUpdate: vi.fn(),
};

// Helper to mock fetch with streaming response
function mockStreamingFetch(chunks: string[], opts?: { fail?: boolean; status?: number }) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/generate-title') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: 'Test Title' }),
      });
    }
    if (opts?.status === 429) {
      return Promise.resolve({ ok: false, status: 429 });
    }
    if (opts?.fail) {
      return Promise.reject(new Error('Network error'));
    }
    const encoder = new TextEncoder();
    let chunkIndex = 0;
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (chunkIndex < chunks.length) {
              const chunk = chunks[chunkIndex++];
              return Promise.resolve({ done: false, value: encoder.encode(chunk) });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      },
    });
  });
}

describe('AIPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title bar and input', () => {
    render(<AIPopover {...defaultProps} />);
    expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument();
  });

  it('renders selection preview', () => {
    render(<AIPopover {...defaultProps} />);
    // Text appears in both title bar and selection preview — use getAllByText
    const matches = screen.getAllByText(/"test selection text"/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows chat number in title when provided', () => {
    render(<AIPopover {...defaultProps} chatNumber={3} />);
    expect(screen.getByText(/Chat 3/)).toBeInTheDocument();
  });

  describe('Bug A fix: error does NOT revert messages', () => {
    it('keeps user message visible on network error', async () => {
      const onMessagesUpdate = vi.fn();
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/ask') {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ title: '' }) });
      });

      render(<AIPopover {...defaultProps} onMessagesUpdate={onMessagesUpdate} />);

      const input = screen.getByPlaceholderText('Ask a question...');
      await userEvent.type(input, 'my question');
      fireEvent.submit(input.closest('form')!);

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      // User message should still be visible (Bug A: NOT reverted)
      // It appears in both the title bar and the chat bubble
      const matches = screen.getAllByText('my question');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Bug D fix: empty response guard', () => {
    it('shows error for empty streaming response', async () => {
      // Stream returns no content (only empty chunks)
      global.fetch = mockStreamingFetch([]);

      render(<AIPopover {...defaultProps} />);

      const input = screen.getByPlaceholderText('Ask a question...');
      await userEvent.type(input, 'my question');
      fireEvent.submit(input.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText('No response received. Please try again.')).toBeInTheDocument();
      });
    });
  });

  describe('Step 11: Retry button', () => {
    it('shows retry button on error', async () => {
      global.fetch = mockStreamingFetch([], { fail: true });

      render(<AIPopover {...defaultProps} />);

      const input = screen.getByPlaceholderText('Ask a question...');
      await userEvent.type(input, 'my question');
      fireEvent.submit(input.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('retry resends the failed message', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/generate-title') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ title: '' }) });
        }
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('First attempt failed'));
        }
        // Second attempt succeeds
        const encoder = new TextEncoder();
        let sent = false;
        return Promise.resolve({
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: () => {
                if (!sent) {
                  sent = true;
                  return Promise.resolve({ done: false, value: encoder.encode('Success!') });
                }
                return Promise.resolve({ done: true, value: undefined });
              },
            }),
          },
        });
      });

      render(<AIPopover {...defaultProps} />);

      // Send initial message
      const input = screen.getByPlaceholderText('Ask a question...');
      await userEvent.type(input, 'my question');
      fireEvent.submit(input.closest('form')!);

      // Wait for error + retry button
      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });

      // Click retry
      fireEvent.click(screen.getByText('Retry'));

      // Should show success response
      await waitFor(() => {
        expect(screen.getByText('Success!')).toBeInTheDocument();
      });
    });
  });

  describe('Bug N fix: skipHtml on Markdown', () => {
    it('does not render raw HTML in assistant messages', async () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'Hello <img src=x onerror=alert(1)> world' },
      ];

      render(<AIPopover {...defaultProps} initialMessages={msgs} />);

      // With skipHtml, raw HTML tags should NOT create real DOM elements
      expect(document.querySelector('img[src="x"]')).toBeNull();
      // The text content should still render (markdown without the HTML)
      expect(screen.getByText(/Hello/)).toBeInTheDocument();
    });
  });

  describe('streaming', () => {
    it('displays streamed content incrementally', async () => {
      global.fetch = mockStreamingFetch(['Hello', ' world', '!']);

      render(<AIPopover {...defaultProps} />);

      const input = screen.getByPlaceholderText('Ask a question...');
      await userEvent.type(input, 'test');
      fireEvent.submit(input.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText('Hello world!')).toBeInTheDocument();
      });
    });
  });

  describe('rate limiting', () => {
    it('shows rate limit warning on 429', async () => {
      global.fetch = mockStreamingFetch([], { status: 429 });

      render(<AIPopover {...defaultProps} />);

      const input = screen.getByPlaceholderText('Ask a question...');
      await userEvent.type(input, 'test');
      fireEvent.submit(input.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/Slow down/)).toBeInTheDocument();
      });
    });
  });

  describe('minimized state', () => {
    it('hides content when minimized', () => {
      render(<AIPopover {...defaultProps} isMinimized={true} />);
      const content = screen.getByPlaceholderText('Ask a question...').closest('[class*="transition-all"]');
      expect(content).toHaveStyle({ maxHeight: '0px' });
    });
  });

  describe('close behavior', () => {
    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      render(<AIPopover {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByLabelText('Close chat'));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
