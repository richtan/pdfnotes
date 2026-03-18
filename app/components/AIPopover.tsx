'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Selection, ChatMessage } from '../hooks/useSelection';

interface AIPopoverProps {
  selections: Selection[];
  chatNumber?: number;
  maxHeight?: number;
  isMinimized?: boolean;
  initialMessages?: ChatMessage[];
  onClose: () => void;
  onMessagesUpdate: (messages: ChatMessage[]) => void;
  onToggleMinimize?: () => void;
  onLoadingChange?: (isLoading: boolean) => void;
  onRemoveSelection?: (selectionId: string) => void;
}

export function AIPopover({
  selections,
  chatNumber,
  maxHeight,
  isMinimized = false,
  initialMessages = [],
  onClose,
  onMessagesUpdate,
  onToggleMinimize,
  onLoadingChange,
  onRemoveSelection,
}: AIPopoverProps) {
  // Primary selection (first one) for backward compatibility and title generation
  const primarySelection = selections[0];
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState<string | null>(null);
  const hasBeenLoadingRef = useRef(false);
  const hasGeneratedTitleRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Notify parent when loading state changes (but not on initial mount)
  useEffect(() => {
    if (isLoading) {
      hasBeenLoadingRef.current = true;
      onLoadingChange?.(true);
    } else if (hasBeenLoadingRef.current) {
      // Only notify false if we were actually loading before
      onLoadingChange?.(false);
    }
  }, [isLoading, onLoadingChange]);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  // Focus input on mount without scrolling (only if not minimized)
  useEffect(() => {
    if (!isMinimized) {
      // Delay focus slightly to allow transition to complete
      const timer = setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isMinimized]);

  // Scroll to bottom when new messages arrive (only if user hasn't scrolled up)
  useEffect(() => {
    if (messagesContainerRef.current && shouldAutoScrollRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Generate title for existing messages on mount (for history items)
  useEffect(() => {
    if (!hasGeneratedTitleRef.current && initialMessages.length >= 2 && primarySelection) {
      hasGeneratedTitleRef.current = true;
      // Delay slightly to avoid too many API calls on initial render
      const timer = setTimeout(async () => {
        try {
          const response = await fetch('/api/generate-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: initialMessages,
              context: primarySelection.text,
            }),
          });
          if (response.ok) {
            const { title } = await response.json();
            if (title) {
              setGeneratedTitle(title);
            }
          }
        } catch {
          // Silently fail
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [initialMessages, primarySelection]);

  // Detect when user manually scrolls
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Check if user is at the bottom (with small threshold for rounding)
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
      shouldAutoScrollRef.current = isAtBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Abort streaming on unmount
  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        abortControllerRef.current?.abort();
        onMessagesUpdate(messages);
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [messages, onClose, onMessagesUpdate]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading || selections.length === 0) return;

    // Reset auto-scroll when sending a new message
    shouldAutoScrollRef.current = true;

    const isFirstUserMessage = !messages.some(m => m.role === 'user');
    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim(),
      ...(isFirstUserMessage ? { selections: [...selections] } : {}),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    // Immediately update parent so message is saved even if user clicks away
    onMessagesUpdate(newMessages);
    setInput('');
    setIsLoading(true);
    setError(null);
    setIsRateLimited(false);

    // Build contexts array for API from selections
    const contexts = selections.map(sel => ({
      type: sel.type,
      text: sel.text,
      imageBase64: sel.imageBase64,
      pageNumber: sel.pageNumber,
    }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userMessage.content,
          contexts,
          conversationHistory: messages,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          setIsRateLimited(true);
          // Keep the user's message in the chat — just stop processing
          setIsLoading(false);
          return;
        }
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;

        // Update messages with streaming content
        const streamingMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: assistantContent }];
        setMessages(streamingMessages);
        // Keep parent updated during streaming so clicking away saves progress
        onMessagesUpdate(streamingMessages);
      }

      // Flush any remaining buffered bytes from the decoder
      assistantContent += decoder.decode();

      // Final update
      const finalMessages: ChatMessage[] = [...newMessages, { role: 'assistant', content: assistantContent }];
      setMessages(finalMessages);
      onMessagesUpdate(finalMessages);

      // Generate title after first successful response (in background)
      if (!hasGeneratedTitleRef.current && finalMessages.length >= 2) {
        hasGeneratedTitleRef.current = true;
        generateTitle(finalMessages);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Aborted — keep partial messages as-is, don't show error
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
        // Remove the user message if there was an error
        setMessages(messages);
        onMessagesUpdate(messages);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, [input, isLoading, messages, selections, onMessagesUpdate]);

  // Generate a title for the chat based on conversation content
  const generateTitle = useCallback(async (msgs: ChatMessage[]) => {
    if (!primarySelection) return;
    try {
      const response = await fetch('/api/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          context: primarySelection.text,
        }),
      });

      if (response.ok) {
        const { title } = await response.json();
        if (title) {
          setGeneratedTitle(title);
        }
      }
    } catch {
      // Silently fail - title generation is not critical
    }
  }, [primarySelection]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  // Get title: prefer generated title, then first user message, then selection preview
  const firstUserMessage = messages.find(m => m.role === 'user');
  const fallbackTitle = firstUserMessage?.content
    || (primarySelection?.type === 'text' && primarySelection?.text ? `"${primarySelection.text.slice(0, 30)}${primarySelection.text.length > 30 ? '...' : ''}"` : 'Ask about selection');
  const baseTitleText = generatedTitle || fallbackTitle;
  // Prefix with chat number if provided
  const titleText = chatNumber ? `Chat ${chatNumber}: ${baseTitleText}` : baseTitleText;


  return (
    <div
      ref={popoverRef}
      className="w-full bg-background rounded-lg shadow-md ring-1 ring-border overflow-hidden flex flex-col transition-all duration-200 ease-out animate-fadeIn"
    >
      {/* Title bar - click to toggle */}
      <div
        className={`shrink-0 flex items-center gap-0 ${
          isMinimized
            ? ''
            : 'bg-muted/50 border-b border-border'
        }`}
      >
        <button
          className={`flex-1 min-w-0 px-3 py-2.5 cursor-pointer transition-colors flex items-center gap-2 text-left ${
            isMinimized
              ? 'hover:bg-muted/50'
              : 'hover:bg-muted'
          }`}
          onClick={() => {
            onMessagesUpdate(messages);
            onToggleMinimize?.();
          }}
          aria-expanded={!isMinimized}
          aria-label={`Chat: ${titleText}`}
        >
          <svg
            className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${isMinimized ? '' : 'rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm text-foreground truncate font-medium flex-1">
            {titleText}
          </span>
        </button>
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            abortControllerRef.current?.abort();
            onMessagesUpdate(messages);
            onClose();
          }}
          className="w-5 h-5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors mr-2"
          aria-label="Close chat"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Expandable content area */}
      <div
        ref={contentRef}
        className="transition-all duration-200 ease-out overflow-hidden flex flex-col"
        style={{
          maxHeight: isMinimized ? '0px' : (maxHeight ? `${maxHeight - 40}px` : '500px'),
          opacity: isMinimized ? 0 : 1,
        }}
      >
        {/* Messages area - scrollable, takes remaining space */}
        <div
          ref={messagesContainerRef}
          className="overflow-y-auto flex-1 min-h-0"
        >
          {/* Selections preview - show existing selections from messages */}
          {selections.length > 0 && (
            <div className="px-3 py-2.5 bg-muted/30 border-b border-border">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-2">
                {selections.length === 1 ? 'Selection' : `Selections (${selections.length})`}
              </p>
              <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
                {selections.map((sel) => (
                  <div
                    key={sel.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-background rounded-md border border-foreground/20 text-xs group"
                  >
                    {/* Type icon */}
                    {sel.type === 'text' ? (
                      <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}

                    {/* Content preview */}
                    <span className="flex-1 truncate text-foreground/80">
                      {sel.type === 'text' && sel.text
                        ? `"${sel.text.slice(0, 40)}${sel.text.length > 40 ? '...' : ''}"`
                        : sel.type === 'area' && sel.imageBase64
                          ? 'Screenshot'
                          : 'Selection'}
                    </span>

                    {/* Page number */}
                    <span className="text-muted-foreground shrink-0">p.{sel.pageNumber}</span>

                    {/* Remove button - only show if there's more than 1 selection or if onRemoveSelection is provided */}
                    {onRemoveSelection && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSelection(sel.id);
                        }}
                        className="w-4 h-4 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove selection"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          <div className="p-3 space-y-2.5">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {message.role === 'user' ? (
                    <p className="text-sm">{message.content}</p>
                  ) : (
                    <div className="text-sm prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 max-w-none prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-li:text-foreground">
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{message.content}</Markdown>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Rate limit warning */}
        {isRateLimited && (
          <div className="px-3 py-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm shrink-0 flex items-center justify-between gap-2">
            <span>Slow down! Please wait a moment before sending another message.</span>
            <button
              onClick={() => setIsRateLimited(false)}
              className="shrink-0 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-3 py-2 bg-destructive/10 text-destructive text-sm shrink-0">
            {error}
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-border shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={messages.length === 0 ? "Ask a question..." : "Follow up..."}
              className="flex-1 h-8 px-3 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-foreground placeholder:text-muted-foreground"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="h-8 w-8 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors flex items-center justify-center"
            >
              {isLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
