import { useState, useCallback } from 'react';

export interface Selection {
  id: string;
  type: 'text' | 'area';
  text: string;
  rect: DOMRect;
  rects?: DOMRect[]; // Multiple rects for text selection (one per line) - deprecated, use rectsByPage
  rectsByPage?: Map<number, DOMRect[]>; // Rects grouped by page number for multi-page selections
  pageNumber: number; // Primary page (for chat window positioning)
  imageBase64?: string;
  timestamp: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  selections?: Selection[];  // Selections attached to this user message (only on user messages)
}

export interface SelectionHistory {
  id: string;                 // Chat ID
  chatNumber: number;         // Sequential integer for display (Chat 1, Chat 2, etc.)
  messages: ChatMessage[];    // Each user message carries its own selections
  // REMOVED: selections: Selection[] - selections are now per-message
}

// Alias for cleaner imports
export type HistoryItem = SelectionHistory;

// Helper to get all selections from a chat (flattened from all user messages)
export function getAllSelectionsFromChat(chat: SelectionHistory): Selection[] {
  const selections: Selection[] = [];
  for (const msg of chat.messages) {
    if (msg.role === 'user' && msg.selections) {
      selections.push(...msg.selections);
    }
  }
  return selections;
}

// Helper to get the first (primary) selection from a chat
export function getPrimarySelection(chat: SelectionHistory): Selection | undefined {
  for (const msg of chat.messages) {
    if (msg.role === 'user' && msg.selections && msg.selections.length > 0) {
      return msg.selections[0];
    }
  }
  return undefined;
}

export function useSelection() {
  const [currentSelection, setCurrentSelection] = useState<Selection | null>(null);
  const [history, setHistory] = useState<SelectionHistory[]>([]);
  const [isAreaSelectMode, setIsAreaSelectMode] = useState(false);
  const [nextChatNumber, setNextChatNumber] = useState(1);

  const setTextSelection = useCallback((
    text: string,
    rect: DOMRect,
    pageNumber: number,
    rects?: DOMRect[],
    rectsByPage?: Map<number, DOMRect[]>
  ) => {
    setCurrentSelection({
      id: crypto.randomUUID(),
      type: 'text',
      text,
      rect,
      rects,
      rectsByPage,
      pageNumber,
      timestamp: Date.now(),
    });
  }, []);

  const setAreaSelection = useCallback((rect: DOMRect, pageNumber: number, imageBase64: string, text?: string) => {
    setCurrentSelection({
      id: crypto.randomUUID(),
      type: 'area',
      text: text || '',
      rect,
      pageNumber,
      imageBase64,
      timestamp: Date.now(),
    });
  }, []);

  const clearSelection = useCallback(() => {
    setCurrentSelection(null);
  }, []);

  const addToHistory = useCallback((messages: ChatMessage[], chatId?: string, chatNumber?: number) => {
    setHistory(prev => {
      const newChatNumber = chatNumber ?? nextChatNumber;
      return [...prev, {
        id: chatId || crypto.randomUUID(),
        chatNumber: newChatNumber,
        messages
      }];
    });
    // Only increment if we used the nextChatNumber
    if (chatNumber === undefined) {
      setNextChatNumber(prev => prev + 1);
    }
  }, [nextChatNumber]);

  const updateHistoryMessages = useCallback((chatId: string, messages: ChatMessage[]) => {
    setHistory(prev => prev.map(h =>
      h.id === chatId ? { ...h, messages } : h
    ));
  }, []);

  // Remove a selection from a specific message in a chat
  // Returns true if the chat should be kept, false if it should be removed (no selections left)
  const removeSelectionFromChat = useCallback((chatId: string, selectionId: string) => {
    setHistory(prev => {
      const updatedHistory = prev.map(h => {
        if (h.id !== chatId) return h;

        // Remove the selection from whichever message contains it
        const updatedMessages = h.messages.map(msg => {
          if (msg.role === 'user' && msg.selections) {
            const filteredSelections = msg.selections.filter(s => s.id !== selectionId);
            return { ...msg, selections: filteredSelections.length > 0 ? filteredSelections : undefined };
          }
          return msg;
        });

        return { ...h, messages: updatedMessages };
      });

      // Remove chat if it has no selections left
      return updatedHistory.filter(h => {
        const allSelections = getAllSelectionsFromChat(h);
        return allSelections.length > 0;
      });
    });
  }, []);

  const removeFromHistory = useCallback((chatId: string) => {
    setHistory(prev => prev.filter(h => h.id !== chatId));
  }, []);

  const toggleAreaSelectMode = useCallback((forceOff?: boolean) => {
    setIsAreaSelectMode(prev => {
      const nextValue = forceOff ? false : !prev;
      // Only clear selection when entering area select mode (to clear text selection)
      if (nextValue && !prev) {
        setCurrentSelection(null);
      }
      return nextValue;
    });
  }, []);

  const getNextChatNumber = useCallback(() => {
    const num = nextChatNumber;
    setNextChatNumber(prev => prev + 1);
    return num;
  }, [nextChatNumber]);

  return {
    currentSelection,
    setCurrentSelection,
    setTextSelection,
    setAreaSelection,
    clearSelection,
    history,
    setHistory,
    addToHistory,
    updateHistoryMessages,
    removeSelectionFromChat,
    removeFromHistory,
    isAreaSelectMode,
    toggleAreaSelectMode,
    nextChatNumber,
    getNextChatNumber,
  };
}
