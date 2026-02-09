'use client';

import { useEffect, useRef } from 'react';

interface ChatPickerProps {
  onNewChat: () => void;
  onCancel: () => void;
}

export function ChatPicker({
  onNewChat,
  onCancel,
}: ChatPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to cancel
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };

    // Delay adding listener to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onCancel]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={pickerRef}
      className="w-64 bg-background rounded-lg shadow-xl ring-1 ring-border overflow-hidden animate-fadeIn"
    >
      {/* New Chat option */}
      <button
        onClick={onNewChat}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
      >
        <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Chat
      </button>
    </div>
  );
}
