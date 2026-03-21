import type { ChatMessage, Selection, HistoryItem } from './hooks/useSelection';

export type { ChatMessage, Selection, HistoryItem };

export interface Tab {
  id: string;
  file: File | string | null; // File object, URL string, or null for empty tab
  name: string;
  numPages?: number;
  loadError?: string;
  // Store chat state per tab
  history: HistoryItem[];
  currentSelection: Selection | null;
  currentMessages: ChatMessage[];
  expandedChatId: string;
  // Store scroll position
  scrollY: number;
}

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const PDF_WIDTH_PERCENT = 65;
export const SIDEBAR_WIDTH_PERCENT = 35;
export const EXPAND_CURRENT = 'current'; // Special value meaning "expand the current selection's chat"

export const createEmptyTab = (): Tab => ({
  id: crypto.randomUUID(),
  file: null,
  name: 'New Tab',
  history: [],
  currentSelection: null,
  currentMessages: [],
  expandedChatId: EXPAND_CURRENT,
  scrollY: 0,
});
