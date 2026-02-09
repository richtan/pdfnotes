'use client';

import { useCallback, useId, useState, useRef, useEffect } from 'react';
import { useResizeObserver } from '@wojtekmaj/react-hooks';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useSelection, type ChatMessage, type Selection, type HistoryItem, getAllSelectionsFromChat, getPrimarySelection } from './hooks/useSelection';
import { AIPopover } from './components/AIPopover';
import { AreaSelector } from './components/AreaSelector';
import { ChatPicker } from './components/ChatPicker';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
};

const resizeObserverOptions = {};
const PDF_WIDTH_PERCENT = 65;
const SIDEBAR_WIDTH_PERCENT = 35;
const EXPAND_CURRENT = 'current'; // Special value meaning "expand the current selection's chat"

interface Tab {
  id: string;
  file: File | string | null; // File object, URL string, or null for empty tab
  name: string;
  numPages?: number;
  // Store chat state per tab
  history: HistoryItem[];
  currentSelection: Selection | null;
  currentMessages: ChatMessage[];
  expandedChatId: string;
  // Store scroll position
  scrollY: number;
}

// Sortable Tab Component
interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
}

function SortableTab({ tab, isActive, onSelect, onClose }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={`group flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded text-xs shrink-0 cursor-grab active:cursor-grabbing transition-colors ${
        isActive
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      }`}
    >
      <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="max-w-24 truncate">{tab.name}</span>
      <span
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-4 h-4 flex items-center justify-center rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    </button>
  );
}

// Tab overlay shown while dragging
function TabOverlay({ tab }: { tab: Tab }) {
  return (
    <div className="flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded text-xs bg-muted text-foreground shadow-lg border border-border">
      <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="max-w-24 truncate">{tab.name}</span>
    </div>
  );
}

// Create initial empty tab
const createEmptyTab = (): Tab => ({
  id: crypto.randomUUID(),
  file: null,
  name: 'New Tab',
  history: [],
  currentSelection: null,
  currentMessages: [],
  expandedChatId: EXPAND_CURRENT,
  scrollY: 0,
});

const initialTab = createEmptyTab();

export default function PDFViewer() {
  const fileId = useId();

  // Tab state - start with one empty tab
  const [tabs, setTabs] = useState<Tab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialTab.id);

  const [scale, setScale] = useState(1);
  const [containerRef, setContainerRef] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [viewportHeight, setViewportHeight] = useState(600);

  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const {
    currentSelection,
    clearSelection,
    history,
    addToHistory,
    updateHistoryMessages,
    removeSelectionFromChat,
    removeFromHistory,
    isAreaSelectMode,
    toggleAreaSelectMode,
    setHistory,
    setCurrentSelection,
    getNextChatNumber,
  } = useSelection();

  // Track the chat number for the current selection
  const [currentChatNumber, setCurrentChatNumber] = useState<number | null>(null);

  // Pending selection - waiting for user to choose which chat to add it to
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null);

  // Track which chat is expanded (by selection ID), EXPAND_CURRENT means current selection is expanded
  const [expandedChatId, setExpandedChatId] = useState<string>(EXPAND_CURRENT);
  const currentMessagesRef = useRef<ChatMessage[]>([]);
  // Track if current selection is generating
  const isCurrentGeneratingRef = useRef(false);
  // Track selections that are still generating (kept mounted in background until done)
  const [generatingSelections, setGeneratingSelections] = useState<Map<string, { selection: Selection; messages: ChatMessage[] }>>(new Map());

  // Page dropdown state
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);
  const [isPageDropdownOpen, setIsPageDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Tab drag-and-drop state
  const [activeId, setActiveId] = useState<string | null>(null);

  // URL input state for empty tabs
  const [urlInput, setUrlInput] = useState('');

  // Drag and drop state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId) || null;

  const onResize = useCallback<ResizeObserverCallback>((entries) => {
    const [entry] = entries;
    if (entry) {
      setContainerWidth(entry.contentRect.width);
    }
  }, []);

  useResizeObserver(containerRef, resizeObserverOptions, onResize);

  // Track viewport height for chat sizing
  useEffect(() => {
    const updateHeight = () => setViewportHeight(window.innerHeight);
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Calculate chat count per page
  const getChatsPerPage = useCallback(() => {
    const counts = new Map<number, number>();
    // Count from history - each chat counts once on its primary page (first selection's page)
    for (const item of history) {
      const primarySel = getPrimarySelection(item);
      if (primarySel) {
        const page = primarySel.pageNumber;
        counts.set(page, (counts.get(page) || 0) + 1);
      }
    }
    // Count current selection if exists
    if (currentSelection) {
      const page = currentSelection.pageNumber;
      counts.set(page, (counts.get(page) || 0) + 1);
    }
    // Count pending selection if exists
    if (pendingSelection) {
      const page = pendingSelection.pageNumber;
      counts.set(page, (counts.get(page) || 0) + 1);
    }
    return counts;
  }, [history, currentSelection, pendingSelection]);

  // Scroll to a specific page
  const scrollToPage = useCallback((pageNum: number) => {
    const pageRef = pageRefs.current.get(pageNum);
    if (pageRef) {
      const headerHeight = 48; // h-12 = 48px
      const padding = 24; // py-6 = 24px top padding
      const elementTop = pageRef.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: elementTop - headerHeight - padding,
        behavior: 'smooth',
      });
    }
    setIsPageDropdownOpen(false);
  }, []);

  // Track current visible page based on scroll position
  useEffect(() => {
    const handleScroll = () => {
      const headerHeight = 48; // h-12 = 48px
      const viewportMiddle = window.scrollY + headerHeight + 100;

      let currentPage = 1;
      pageRefs.current.forEach((ref, pageNum) => {
        const rect = ref.getBoundingClientRect();
        const pageTop = window.scrollY + rect.top;
        if (pageTop <= viewportMiddle) {
          currentPage = pageNum;
        }
      });

      setCurrentVisiblePage(currentPage);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check
    return () => window.removeEventListener('scroll', handleScroll);
  }, [activeTab?.numPages]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsPageDropdownOpen(false);
      }
    };

    if (isPageDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isPageDropdownOpen]);

  // Save current tab state before switching
  const saveCurrentTabState = useCallback(() => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? {
            ...tab,
            history,
            currentSelection,
            currentMessages: currentMessagesRef.current,
            expandedChatId,
            scrollY: window.scrollY,
          }
        : tab
    ));
  }, [activeTabId, history, currentSelection, expandedChatId]);

  // Switch to a tab
  const switchToTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return;

    // Save current state
    saveCurrentTabState();

    // Find the tab to switch to
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Restore tab state
    setHistory(tab.history);
    setCurrentSelection(tab.currentSelection);
    currentMessagesRef.current = tab.currentMessages;
    setExpandedChatId(tab.expandedChatId);
    setActiveTabId(tabId);

    // Restore scroll position after a brief delay to let the DOM update
    requestAnimationFrame(() => {
      window.scrollTo(0, tab.scrollY);
    });
  }, [activeTabId, tabs, saveCurrentTabState, setHistory, setCurrentSelection]);

  // Close a tab
  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const tabIndex = tabs.findIndex(t => t.id === tabId);
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    if (tabId === activeTabId) {
      if (newTabs.length === 0) {
        setActiveTabId(null);
        setHistory([]);
        setCurrentSelection(null);
        currentMessagesRef.current = [];
      } else {
        // Switch to adjacent tab
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        const newTab = newTabs[newIndex];
        setHistory(newTab.history);
        setCurrentSelection(newTab.currentSelection);
        currentMessagesRef.current = newTab.currentMessages;
        setExpandedChatId(newTab.expandedChatId);
        setActiveTabId(newTab.id);
      }
    }
  }, [tabs, activeTabId, setHistory, setCurrentSelection]);

  // Tab drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex(t => t.id === active.id);
      const newIndex = tabs.findIndex(t => t.id === over.id);
      setTabs(arrayMove(tabs, oldIndex, newIndex));
    }

    setActiveId(null);
  }, [tabs]);

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const { files } = event.target;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const currentTab = tabs.find(t => t.id === activeTabId);
    const isCurrentTabEmpty = currentTab && !currentTab.file;

    if (isCurrentTabEmpty && fileArray.length === 1) {
      // Load single file into current empty tab
      const file = fileArray[0];
      setTabs(prev => prev.map(tab =>
        tab.id === activeTabId
          ? { ...tab, file, name: file.name.replace(/\.pdf$/i, '') }
          : tab
      ));
      pageRefs.current.clear();
    } else {
      // Save current tab state before creating new tabs
      saveCurrentTabState();

      // If current tab is empty, load first file into it
      let remainingFiles = fileArray;
      if (isCurrentTabEmpty) {
        const firstFile = fileArray[0];
        setTabs(prev => prev.map(tab =>
          tab.id === activeTabId
            ? { ...tab, file: firstFile, name: firstFile.name.replace(/\.pdf$/i, '') }
            : tab
        ));
        remainingFiles = fileArray.slice(1);
      }

      // Create new tabs for remaining files
      if (remainingFiles.length > 0) {
        const newTabs: Tab[] = remainingFiles.map(file => ({
          id: crypto.randomUUID(),
          file,
          name: file.name.replace(/\.pdf$/i, ''),
          history: [],
          currentSelection: null,
          currentMessages: [],
          expandedChatId: EXPAND_CURRENT,
          scrollY: 0,
        }));

        setTabs(prev => [...prev, ...newTabs]);

        // Activate the last uploaded tab
        const lastTab = newTabs[newTabs.length - 1];
        setActiveTabId(lastTab.id);

        // Reset state for new tab
        setHistory([]);
        setCurrentSelection(null);
        currentMessagesRef.current = [];
        setExpandedChatId(EXPAND_CURRENT);
        pageRefs.current.clear();
        window.scrollTo(0, 0);
      }
    }

    // Reset file input
    event.target.value = '';
  }

  function onUrlSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;

    // Extract filename from URL or use a default name
    let name = 'PDF from URL';
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      if (filename && filename.endsWith('.pdf')) {
        name = filename.replace(/\.pdf$/i, '');
      } else if (filename) {
        name = filename;
      }
    } catch {
      // Invalid URL, will be handled by react-pdf
    }

    const currentTab = tabs.find(t => t.id === activeTabId);
    const isCurrentTabEmpty = currentTab && !currentTab.file;

    if (isCurrentTabEmpty) {
      // Load URL into current empty tab
      setTabs(prev => prev.map(tab =>
        tab.id === activeTabId
          ? { ...tab, file: url, name }
          : tab
      ));
      pageRefs.current.clear();
    } else {
      // Save current tab state before creating new tab
      saveCurrentTabState();

      const newTab: Tab = {
        id: crypto.randomUUID(),
        file: url,
        name,
        history: [],
        currentSelection: null,
        currentMessages: [],
        expandedChatId: EXPAND_CURRENT,
        scrollY: 0,
      };

      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);

      // Reset state for new tab
      setHistory([]);
      setCurrentSelection(null);
      currentMessagesRef.current = [];
      setExpandedChatId(EXPAND_CURRENT);
      pageRefs.current.clear();
      window.scrollTo(0, 0);
    }

    setUrlInput('');
  }

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDraggingFile(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    dragCounter.current = 0;

    const files = Array.from(e.dataTransfer.files).filter(
      file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );

    if (files.length === 0) return;

    const currentTab = tabs.find(t => t.id === activeTabId);
    const isCurrentTabEmpty = currentTab && !currentTab.file;

    if (isCurrentTabEmpty && files.length === 1) {
      // Load single file into current empty tab
      const file = files[0];
      setTabs(prev => prev.map(tab =>
        tab.id === activeTabId
          ? { ...tab, file, name: file.name.replace(/\.pdf$/i, '') }
          : tab
      ));
      pageRefs.current.clear();
    } else {
      // Save current tab state before creating new tabs
      saveCurrentTabState();

      // If current tab is empty, load first file into it
      let remainingFiles = files;
      if (isCurrentTabEmpty) {
        const firstFile = files[0];
        setTabs(prev => prev.map(tab =>
          tab.id === activeTabId
            ? { ...tab, file: firstFile, name: firstFile.name.replace(/\.pdf$/i, '') }
            : tab
        ));
        remainingFiles = files.slice(1);
      }

      // Create new tabs for remaining files
      if (remainingFiles.length > 0) {
        const newTabs: Tab[] = remainingFiles.map(file => ({
          id: crypto.randomUUID(),
          file,
          name: file.name.replace(/\.pdf$/i, ''),
          history: [],
          currentSelection: null,
          currentMessages: [],
          expandedChatId: EXPAND_CURRENT,
          scrollY: 0,
        }));

        setTabs(prev => [...prev, ...newTabs]);

        // Activate the last dropped tab
        const lastTab = newTabs[newTabs.length - 1];
        setActiveTabId(lastTab.id);

        // Reset state for new tab
        setHistory([]);
        setCurrentSelection(null);
        currentMessagesRef.current = [];
        setExpandedChatId(EXPAND_CURRENT);
        pageRefs.current.clear();
        window.scrollTo(0, 0);
      }
    }
  }, [tabs, activeTabId, saveCurrentTabState, setHistory, setCurrentSelection]);

  const onDocumentLoadSuccess = useCallback((tabId: string) => ({ numPages: nextNumPages }: PDFDocumentProxy): void => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId ? { ...tab, numPages: nextNumPages } : tab
    ));
  }, []);

  const handleTextSelection = useCallback(() => {
    if (isAreaSelectMode) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Get all individual rects (one per line of text)
    const clientRects = Array.from(range.getClientRects());

    // Group rects by page
    const rectsByPage = new Map<number, DOMRect[]>();
    let primaryPageNumber = 1;
    let maxRectsOnPage = 0;

    // Filter out anomalously large rects (likely the overall bounding rect)
    // Normal text line rects should be less than ~50px tall
    const MAX_LINE_HEIGHT = 60;
    const validRects = clientRects.filter(r => r.height <= MAX_LINE_HEIGHT && r.width > 0);

    // Convert pageRefs to array for proper iteration with break
    const pageEntries = Array.from(pageRefs.current.entries());

    validRects.forEach(clientRect => {
      // Find which page this rect belongs to (only add to first matching page)
      for (const [pageNum, pageRef] of pageEntries) {
        const pageRect = pageRef.getBoundingClientRect();
        // Check if the rect's center is within this page
        const rectCenterY = clientRect.top + clientRect.height / 2;
        if (rectCenterY >= pageRect.top && rectCenterY <= pageRect.bottom) {
          // Convert to relative position
          const relativeRect = new DOMRect(
            clientRect.x - pageRect.x,
            clientRect.y - pageRect.y,
            clientRect.width,
            clientRect.height
          );

          if (!rectsByPage.has(pageNum)) {
            rectsByPage.set(pageNum, []);
          }
          rectsByPage.get(pageNum)!.push(relativeRect);

          // Track which page has the most rects (for primary page)
          const rectsOnThisPage = rectsByPage.get(pageNum)!.length;
          if (rectsOnThisPage > maxRectsOnPage) {
            maxRectsOnPage = rectsOnThisPage;
            primaryPageNumber = pageNum;
          }
          break; // Only add to one page
        }
      }
    });

    // If no rects were grouped, fall back to finding the page containing the overall rect
    if (rectsByPage.size === 0) {
      pageRefs.current.forEach((pageRef, num) => {
        const pageRect = pageRef.getBoundingClientRect();
        if (rect.top >= pageRect.top && rect.bottom <= pageRect.bottom) {
          primaryPageNumber = num;
        }
      });
    }

    const primaryPageRef = pageRefs.current.get(primaryPageNumber);
    if (primaryPageRef) {
      const primaryPageRect = primaryPageRef.getBoundingClientRect();
      const relativeRect = new DOMRect(
        rect.x - primaryPageRect.x,
        rect.y - primaryPageRect.y,
        rect.width,
        rect.height
      );

      // Get rects for primary page (for backward compatibility)
      const primaryRects = rectsByPage.get(primaryPageNumber) || [];

      // Create the new selection object
      const newSelection: Selection = {
        id: crypto.randomUUID(),
        type: 'text',
        text,
        rect: relativeRect,
        rects: primaryRects,
        rectsByPage,
        pageNumber: primaryPageNumber,
        timestamp: Date.now(),
      };

      // Set as pending selection (user will choose which chat to add it to)
      setPendingSelection(newSelection);
    }
  }, [isAreaSelectMode]);

  const handleAreaSelect = useCallback((rect: DOMRect, pageNumber: number, imageBase64: string) => {
    // Create the new selection object
    const newSelection: Selection = {
      id: crypto.randomUUID(),
      type: 'area',
      text: '',
      rect,
      pageNumber,
      imageBase64,
      timestamp: Date.now(),
    };

    // Set as pending selection (user will choose which chat to add it to)
    setPendingSelection(newSelection);
    toggleAreaSelectMode(true); // Force off
  }, [toggleAreaSelectMode]);

  const handleAreaCancel = useCallback(() => {
    toggleAreaSelectMode(true); // Force off
  }, [toggleAreaSelectMode]);

  // Handle creating a new chat with the pending selection
  const handleNewChat = useCallback(() => {
    if (!pendingSelection) return;

    // Handle current selection before creating new one
    if (currentSelection && currentMessagesRef.current.length > 0) {
      if (isCurrentGeneratingRef.current) {
        // Keep generating selection mounted in background
        setGeneratingSelections(prev => {
          const next = new Map(prev);
          next.set(currentSelection.id, {
            selection: currentSelection,
            messages: [...currentMessagesRef.current],
          });
          return next;
        });
      } else {
        // Not generating, move directly to history (with current chat number)
        addToHistory(currentMessagesRef.current, undefined, currentChatNumber ?? undefined);
      }
    }

    // Assign a new chat number
    const newChatNumber = getNextChatNumber();
    setCurrentChatNumber(newChatNumber);

    // Reset for new selection
    currentMessagesRef.current = [];
    isCurrentGeneratingRef.current = false;
    setCurrentSelection(pendingSelection);
    setPendingSelection(null);
    // Expand the new selection's chat
    setExpandedChatId(EXPAND_CURRENT);
    // Clear browser text selection
    window.getSelection()?.removeAllRanges();
  }, [pendingSelection, currentSelection, addToHistory, setCurrentSelection, currentChatNumber, getNextChatNumber]);


  // Handle canceling the pending selection
  const handleCancelPendingSelection = useCallback(() => {
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const handlePopoverClose = useCallback(() => {
    // If there are messages, add to history before clearing
    if (currentSelection && currentMessagesRef.current.length > 0) {
      addToHistory(currentMessagesRef.current, undefined, currentChatNumber ?? undefined);
    }
    currentMessagesRef.current = [];
    isCurrentGeneratingRef.current = false;
    setCurrentChatNumber(null);
    clearSelection();
    window.getSelection()?.removeAllRanges();
  }, [currentSelection, currentChatNumber, addToHistory, clearSelection]);

  // Handle loading state change for current selection
  const handleCurrentLoadingChange = useCallback((loading: boolean) => {
    isCurrentGeneratingRef.current = loading;
  }, []);

  // Handle when a background generating selection finishes
  const handleGeneratingComplete = useCallback((selectionId: string, messages: ChatMessage[]) => {
    setGeneratingSelections(prev => {
      const item = prev.get(selectionId);
      if (item) {
        // Move to history - messages should already have selections attached
        addToHistory(messages);
        // Remove from generating
        const next = new Map(prev);
        next.delete(selectionId);
        return next;
      }
      return prev;
    });
  }, [addToHistory]);

  // Handle messages update for a generating selection
  const handleGeneratingMessagesUpdate = useCallback((selectionId: string, messages: ChatMessage[]) => {
    setGeneratingSelections(prev => {
      const item = prev.get(selectionId);
      if (item) {
        const next = new Map(prev);
        next.set(selectionId, { ...item, messages });
        return next;
      }
      return prev;
    });
  }, []);

  // Mouse down on PDF area to minimize chats (not close them, so generation continues)
  // Using mouseDown instead of click so it doesn't interfere with text selection (drag)
  const handlePdfMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't minimize if in area select mode
    if (isAreaSelectMode) return;

    const target = e.target as HTMLElement;
    // Check if click was on selection highlight or chat picker
    if (target.closest('[data-selection-highlight]') || target.closest('[data-chat-picker]')) return;

    // Cancel pending selection if there is one
    if (pendingSelection) {
      setPendingSelection(null);
    }

    // Just minimize all chats - don't close them so generation can continue
    // User can use X button to fully close/remove a chat
    setExpandedChatId('none');
  }, [isAreaSelectMode, pendingSelection]);

  const handleCurrentMessagesUpdate = useCallback((messages: ChatMessage[]) => {
    currentMessagesRef.current = messages;
  }, []);

  // Calculate page width - use available container width minus padding
  const pageWidth = ((containerWidth || 800) - 32) * scale;

  const setPageRef = useCallback((pageNum: number) => (ref: HTMLDivElement | null) => {
    if (ref) {
      pageRefs.current.set(pageNum, ref);
    } else {
      pageRefs.current.delete(pageNum);
    }
  }, []);

  // Calculate Y position for a selection relative to the document start
  const getSelectionYPosition = useCallback((selection: { pageNumber: number; rect: DOMRect }) => {
    let offsetTop = 0;
    // Add heights of all pages before this one (plus 32px gap between pages)
    for (let i = 1; i < selection.pageNumber; i++) {
      const pageRef = pageRefs.current.get(i);
      if (pageRef) {
        offsetTop += pageRef.offsetHeight + 32;
      }
    }
    // Add the selection's position within its page
    offsetTop += selection.rect.y;
    return offsetTop;
  }, []);

  // Calculate picker position for pending selection
  // Returns { top, left, showAbove } for positioning the chat picker
  const getPickerPosition = useCallback((selection: Selection) => {
    // For multi-page selections, find the last page with rects
    let anchorPageNum = selection.pageNumber;
    let anchorRect = selection.rect;

    if (selection.rectsByPage && selection.rectsByPage.size > 0) {
      // Get the highest page number (last page of selection)
      const pageNumbers = Array.from(selection.rectsByPage.keys()).sort((a, b) => b - a);
      const lastPage = pageNumbers[0];
      const rectsOnLastPage = selection.rectsByPage.get(lastPage);
      if (rectsOnLastPage && rectsOnLastPage.length > 0) {
        anchorPageNum = lastPage;
        // Get the last (bottom-most) rect on that page
        const lastRect = rectsOnLastPage.reduce((lowest, r) =>
          r.y + r.height > lowest.y + lowest.height ? r : lowest
        );
        anchorRect = lastRect;
      }
    }

    // Calculate Y offset to the anchor page
    let pageOffsetY = 0;
    for (let i = 1; i < anchorPageNum; i++) {
      const pageRef = pageRefs.current.get(i);
      if (pageRef) {
        pageOffsetY += pageRef.offsetHeight + 32; // 32px = gap-8 between pages
      }
    }

    const PICKER_HEIGHT = 200;
    const PICKER_WIDTH = 256;
    const HEADER_HEIGHT = 48; // h-12 = 48px
    const CONTAINER_PADDING = 24; // py-6 = 24px

    // Position within PDF container (relative to container start)
    const belowY = pageOffsetY + anchorRect.y + anchorRect.height + 8;
    const aboveY = pageOffsetY + anchorRect.y - 8;

    // Convert to screen position to check viewport fit
    const containerTop = HEADER_HEIGHT + CONTAINER_PADDING;
    const screenBelowY = containerTop + belowY - window.scrollY;
    const screenAboveY = containerTop + aboveY - window.scrollY - PICKER_HEIGHT;

    // Check viewport fit
    const fitsBelow = screenBelowY + PICKER_HEIGHT <= viewportHeight;
    const fitsAbove = screenAboveY >= HEADER_HEIGHT;

    // Decide direction (prefer below, but flip if needed)
    const showAbove = !fitsBelow && fitsAbove;
    const top = showAbove ? aboveY : belowY;

    // Horizontal: ensure picker stays within bounds
    // Center horizontally on the rect, but clamp to keep picker fully visible
    const centerX = anchorRect.x + anchorRect.width / 2;
    const left = Math.max(
      PICKER_WIDTH / 2, // Don't go off left edge (since we use translateX(-50%))
      Math.min(centerX, pageWidth - PICKER_WIDTH / 2) // Don't go off right edge
    );

    return { top, left, showAbove };
  }, [pageWidth, viewportHeight]);

  return (
    <div
      className={`min-h-screen ${isDarkMode ? 'dark' : ''} bg-background`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag and drop overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-xl border-2 border-dashed border-primary bg-background shadow-lg">
            <svg className="w-12 h-12 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-medium text-foreground">Drop PDF files here</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="px-4 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h1 className="text-sm font-medium text-foreground tracking-tight shrink-0">
              PDF Notes
            </h1>

            {/* Divider */}
            <div className="h-4 w-px bg-border shrink-0" />

            {/* Tabs */}
            <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={tabs.map(t => t.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="flex items-center gap-0.5">
                    {tabs.map((tab) => (
                      <SortableTab
                        key={tab.id}
                        tab={tab}
                        isActive={tab.id === activeTabId}
                        onSelect={() => switchToTab(tab.id)}
                        onClose={(e) => closeTab(tab.id, e)}
                      />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeId ? (
                    <TabOverlay tab={tabs.find(t => t.id === activeId)!} />
                  ) : null}
                </DragOverlay>
              </DndContext>

              {/* Add tab button */}
              <button
                onClick={() => {
                  saveCurrentTabState();
                  const newTab = createEmptyTab();
                  setTabs(prev => [...prev, newTab]);
                  setActiveTabId(newTab.id);
                  setHistory([]);
                  setCurrentSelection(null);
                  currentMessagesRef.current = [];
                  setExpandedChatId(EXPAND_CURRENT);
                  setUrlInput('');
                }}
                className="h-7 w-7 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors shrink-0"
                title="New Tab"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {activeTab && (
            <div className="flex items-center gap-1">
              {/* Page dropdown */}
              {activeTab.numPages && activeTab.numPages > 1 && (
                <>
                  <div ref={dropdownRef} className="relative">
                    <button
                      onClick={() => setIsPageDropdownOpen(!isPageDropdownOpen)}
                      className="h-8 pl-3 pr-8 text-sm bg-transparent border border-border rounded-md text-foreground cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring flex items-center gap-2"
                    >
                      <span>Page {currentVisiblePage}</span>
                      <span className="text-muted-foreground">/ {activeTab.numPages}</span>
                    </button>
                    <svg
                      className={`absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none transition-transform duration-200 ${isPageDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                    </svg>

                    {/* Dropdown menu */}
                    {isPageDropdownOpen && activeTab.numPages && (
                      <div className="absolute top-full left-0 mt-1 min-w-full max-h-64 overflow-y-auto bg-background border border-border rounded-md shadow-lg z-50 py-1 animate-fadeIn">
                        {Array.from({ length: activeTab.numPages }, (_, i) => {
                          const pageNum = i + 1;
                          const chatCount = getChatsPerPage().get(pageNum) || 0;
                          const isCurrentPage = pageNum === currentVisiblePage;
                          return (
                            <button
                              key={pageNum}
                              onClick={() => scrollToPage(pageNum)}
                              className={`w-full px-3 py-1.5 text-sm text-left flex items-center justify-between transition-colors ${
                                isCurrentPage
                                  ? 'bg-muted text-foreground'
                                  : 'text-foreground hover:bg-muted/50'
                              }`}
                            >
                              <span>Page {pageNum}</span>
                              {chatCount > 0 && (
                                <span className="ml-2 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full tabular-nums">
                                  {chatCount}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Divider */}
                  <div className="h-4 w-px bg-border mx-2" />
                </>
              )}

              {/* Zoom controls */}
              <div className="flex items-center">
                <button
                  onClick={() => setScale(s => Math.max(0.5, s - 0.1))}
                  className="h-8 w-8 rounded-md hover:bg-muted text-foreground flex items-center justify-center transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H4" />
                  </svg>
                </button>
                <span className="text-sm text-foreground min-w-[44px] text-center tabular-nums">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={() => setScale(s => Math.min(2, s + 0.1))}
                  className="h-8 w-8 rounded-md hover:bg-muted text-foreground flex items-center justify-center transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>

              {/* Screenshot tool */}
              <button
                onClick={() => toggleAreaSelectMode()}
                className={`h-8 px-3 rounded-md flex items-center gap-2 text-sm font-medium transition-colors border ${
                  isAreaSelectMode
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background hover:bg-muted text-foreground border-border'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {isAreaSelectMode ? 'Cancel' : 'Screenshot'}
              </button>

              {/* Dark mode toggle */}
              <button
                onClick={() => setIsDarkMode(d => !d)}
                className="h-8 w-8 rounded-md hover:bg-muted text-foreground flex items-center justify-center transition-colors"
              >
                {isDarkMode ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      </header>


      {/* Main content */}
      <main className="relative">
        {activeTab && !activeTab.file ? (
          /* Empty tab - show upload UI */
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-16 h-16 mb-6 text-muted-foreground/30">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-foreground mb-1">
              Open a document
            </h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Drop a PDF, upload a file, or paste a URL to start asking AI-powered questions
            </p>
            <div className="flex flex-col items-center gap-4 w-full max-w-sm">
              <label
                htmlFor={fileId}
                className="cursor-pointer h-10 px-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors inline-flex items-center"
              >
                Upload PDF
              </label>
              <input
                id={fileId}
                onChange={onFileChange}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
              />
              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <form onSubmit={onUrlSubmit} className="flex items-center gap-2 w-full">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Paste PDF URL..."
                  className="flex-1 h-10 px-3 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={!urlInput.trim()}
                  className="h-10 px-4 bg-secondary hover:bg-secondary/80 disabled:opacity-40 text-secondary-foreground rounded-md text-sm font-medium transition-colors"
                >
                  Open
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex w-full">
            {/* PDF Document area - render all tabs, show only active */}
            <div
              ref={setContainerRef}
              className="relative flex flex-col items-center py-6 px-2 min-w-0"
              style={{ width: `${PDF_WIDTH_PERCENT}%` }}
              onMouseDown={handlePdfMouseDown}
              onMouseUp={handleTextSelection}
            >
              {tabs.filter(tab => tab.file).map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    style={{
                      visibility: isActive ? 'visible' : 'hidden',
                      position: isActive ? 'relative' : 'absolute',
                      top: isActive ? undefined : 0,
                      left: isActive ? undefined : 0,
                      pointerEvents: isActive ? 'auto' : 'none',
                    }}
                  >
                    <Document
                      file={tab.file}
                      onLoadSuccess={onDocumentLoadSuccess(tab.id)}
                      options={options}
                      className="flex flex-col items-center gap-6"
                    >
                      {tab.numPages ? Array.from(new Array(tab.numPages), (_el, index) => {
                        const pageNum = index + 1;
                        return (
                          <div
                            key={`page_${pageNum}`}
                            ref={isActive ? setPageRef(pageNum) : undefined}
                            className="relative shadow-sm ring-1 ring-border/50 rounded-lg overflow-hidden bg-white"
                          >
                            <Page
                              pageNumber={pageNum}
                              width={pageWidth}
                              renderTextLayer={true}
                              renderAnnotationLayer={true}
                            />

                            {/* Area selector overlay - only on active tab */}
                            {isActive && isAreaSelectMode && (
                              <AreaSelector
                                containerRef={pageRefs.current.get(pageNum) || null}
                                pageNumber={pageNum}
                                onSelect={handleAreaSelect}
                                onCancel={handleAreaCancel}
                              />
                            )}

                            {/* Selection highlights - only on active tab */}
                            {isActive && (() => {
                              // Helper to check if selection has rects on this page
                              const hasRectsOnPage = (sel: typeof currentSelection) => {
                                if (!sel) return false;
                                // Check rectsByPage first, then fall back to pageNumber
                                if (sel.rectsByPage?.has(pageNum)) return true;
                                return sel.pageNumber === pageNum;
                              };

                              // Get rects for a selection on this page
                              const getRectsForPage = (sel: NonNullable<typeof currentSelection>) => {
                                // Use rectsByPage if available for this page
                                if (sel.rectsByPage?.has(pageNum)) {
                                  return sel.rectsByPage.get(pageNum)!;
                                }
                                // Fall back to rects array if on primary page
                                if (sel.pageNumber === pageNum) {
                                  return sel.rects || [sel.rect];
                                }
                                return [];
                              };

                              // Determine which selection to highlight based on focused chat
                              // isPending means it's a pending selection (dashed border)
                              const selectionsToHighlight: Array<{ selection: typeof currentSelection, isFocused: boolean, isPending?: boolean, chatId?: string }> = [];

                              // Pending selection - distinct dashed style
                              if (pendingSelection && hasRectsOnPage(pendingSelection)) {
                                selectionsToHighlight.push({
                                  selection: pendingSelection,
                                  isFocused: true,
                                  isPending: true,
                                });
                              }

                              // Current selection - highlighted when its chat is focused (expandedChatId === EXPAND_CURRENT)
                              if (currentSelection && hasRectsOnPage(currentSelection)) {
                                selectionsToHighlight.push({
                                  selection: currentSelection,
                                  isFocused: expandedChatId === EXPAND_CURRENT
                                });
                              }

                              // History items - highlighted when their chat is focused
                              // Each history item has selections attached to user messages
                              history.forEach(item => {
                                const allSelections = getAllSelectionsFromChat(item);
                                allSelections.forEach(sel => {
                                  if (hasRectsOnPage(sel)) {
                                    selectionsToHighlight.push({
                                      selection: sel,
                                      isFocused: expandedChatId === item.id,
                                      chatId: item.id,
                                    });
                                  }
                                });
                              });

                              // Generating selections (background) - highlighted when their chat is focused
                              generatingSelections.forEach(({ selection: genSelection }) => {
                                if (hasRectsOnPage(genSelection)) {
                                  selectionsToHighlight.push({
                                    selection: genSelection,
                                    isFocused: expandedChatId === genSelection.id
                                  });
                                }
                              });

                              return selectionsToHighlight.map(({ selection, isFocused, isPending, chatId }) => {
                                if (!selection) return null;

                                const handleMouseDown = (e: React.MouseEvent) => {
                                  e.stopPropagation(); // Prevent handlePdfMouseDown from running
                                };
                                const handleClick = (e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  // Don't change focus for pending selections
                                  if (isPending) return;
                                  // For currentSelection, expandedChatId should be EXPAND_CURRENT
                                  // For history items, it should be the chat id
                                  const isCurrentSel = currentSelection?.id === selection.id;
                                  setExpandedChatId(isCurrentSel ? EXPAND_CURRENT : (chatId || selection.id));
                                };

                                // Pending selections have dashed amber border (waiting for chat assignment)
                                const pendingClasses = 'border-dashed border-2 border-amber-500 bg-amber-500/10';
                                const focusedClasses = 'border-blue-500 bg-blue-500/10';
                                const unfocusedClasses = 'border-blue-400/50 bg-blue-400/5 hover:bg-blue-400/10';
                                const focusedTextClasses = 'bg-blue-500/30';
                                const unfocusedTextClasses = 'bg-blue-400/15 hover:bg-blue-400/25';
                                const pendingTextClasses = 'bg-amber-500/20';

                                // Determine the appropriate class based on state
                                const getAreaClass = () => {
                                  if (isPending) return pendingClasses;
                                  if (isFocused) return focusedClasses;
                                  return unfocusedClasses;
                                };

                                const getTextClass = () => {
                                  if (isPending) return pendingTextClasses;
                                  if (isFocused) return focusedTextClasses;
                                  return unfocusedTextClasses;
                                };

                                if (selection.type === 'area') {
                                  return (
                                    <div
                                      key={selection.id}
                                      data-selection-highlight
                                      onMouseDown={handleMouseDown}
                                      onClick={handleClick}
                                      className={`absolute cursor-pointer rounded-sm border-2 transition-colors z-10 ${getAreaClass()}`}
                                      style={{
                                        left: selection.rect.x,
                                        top: selection.rect.y,
                                        width: selection.rect.width,
                                        height: selection.rect.height,
                                      }}
                                    />
                                  );
                                } else {
                                  // Text selection - render rects for this page
                                  const rectsForThisPage = getRectsForPage(selection);
                                  return rectsForThisPage.map((r, i) => (
                                    <div
                                      key={`${selection.id}-${pageNum}-${i}`}
                                      data-selection-highlight
                                      onMouseDown={handleMouseDown}
                                      onClick={handleClick}
                                      className={`absolute cursor-pointer transition-colors z-10 ${getTextClass()}`}
                                      style={{
                                        left: r.x,
                                        top: r.y,
                                        width: r.width,
                                        height: r.height,
                                      }}
                                    />
                                  ));
                                }
                              });
                            })()}
                          </div>
                        );
                      }) : null}
                    </Document>
                  </div>
                );
              })}

              {/* Chat picker - positioned at PDF container level to avoid overflow clipping */}
              {pendingSelection && (() => {
                const pos = getPickerPosition(pendingSelection);
                return (
                  <div
                    data-chat-picker
                    className="absolute z-20"
                    style={{
                      left: pos.left,
                      top: pos.top,
                      transform: `translateX(-50%)${pos.showAbove ? ' translateY(-100%)' : ''}`,
                    }}
                  >
                    <ChatPicker
                      onNewChat={handleNewChat}
                      onCancel={handleCancelPendingSelection}
                    />
                  </div>
                );
              })()}
            </div>

            {/* Comments sidebar - scrolls with PDF */}
            <div
              className="shrink-0 relative"
              style={{ width: `${SIDEBAR_WIDTH_PERCENT}%` }}
            >
              {/* Current selection */}
              {currentSelection && (
                <div
                  className="absolute left-0 right-0 px-3"
                  style={{
                    top: `${getSelectionYPosition(currentSelection) + 24 + currentSelection.rect.height / 2}px`,
                    transform: 'translateY(-50%)',
                  }}
                >
                  <AIPopover
                    key={currentSelection.id}
                    selections={[currentSelection]}
                    chatNumber={currentChatNumber ?? undefined}
                    maxHeight={expandedChatId === EXPAND_CURRENT ? Math.min(viewportHeight - 150, 500) : undefined}
                    isMinimized={expandedChatId !== EXPAND_CURRENT}
                    onClose={handlePopoverClose}
                    onMessagesUpdate={handleCurrentMessagesUpdate}
                    onToggleMinimize={() => setExpandedChatId(expandedChatId === EXPAND_CURRENT ? 'none' : EXPAND_CURRENT)}
                    onLoadingChange={handleCurrentLoadingChange}
                  />
                </div>
              )}

              {/* Background generating selections (hidden but mounted to continue generation) */}
              {Array.from(generatingSelections.values()).map(({ selection, messages }) => (
                <div
                  key={`generating-${selection.id}`}
                  className="absolute left-0 right-0 px-3"
                  style={{
                    top: `${getSelectionYPosition(selection) + 24 + selection.rect.height / 2}px`,
                    transform: 'translateY(-50%)',
                  }}
                >
                  <AIPopover
                    selections={[selection]}
                    isMinimized={expandedChatId !== selection.id}
                    initialMessages={messages}
                    onClose={() => {
                      // Remove from generating and don't add to history
                      setGeneratingSelections(prev => {
                        const next = new Map(prev);
                        next.delete(selection.id);
                        return next;
                      });
                    }}
                    onMessagesUpdate={(msgs) => handleGeneratingMessagesUpdate(selection.id, msgs)}
                    onToggleMinimize={() => setExpandedChatId(
                      expandedChatId === selection.id ? 'none' : selection.id
                    )}
                    onLoadingChange={(loading) => {
                      if (!loading) {
                        // Generation finished, move to history
                        const genItem = generatingSelections.get(selection.id);
                        if (genItem) {
                          handleGeneratingComplete(selection.id, genItem.messages);
                        }
                      }
                    }}
                  />
                </div>
              ))}

              {/* History items */}
              {history.map((item) => {
                // Position based on first selection in the chat
                const primarySel = getPrimarySelection(item);
                if (!primarySel) return null;

                const allSelections = getAllSelectionsFromChat(item);

                return (
                  <div
                    key={item.id}
                    className="absolute left-0 right-0 px-3"
                    style={{
                      top: `${getSelectionYPosition(primarySel) + 24 + primarySel.rect.height / 2}px`,
                      transform: 'translateY(-50%)',
                    }}
                  >
                    <AIPopover
                      selections={allSelections}
                      chatNumber={item.chatNumber}
                      maxHeight={expandedChatId === item.id ? Math.min(viewportHeight - 150, 500) : undefined}
                      isMinimized={expandedChatId !== item.id}
                      initialMessages={item.messages}
                      onClose={() => removeFromHistory(item.id)}
                      onMessagesUpdate={(messages) => updateHistoryMessages(item.id, messages)}
                      onToggleMinimize={() => setExpandedChatId(
                        expandedChatId === item.id ? 'none' : item.id
                      )}
                      onRemoveSelection={(selectionId) => removeSelectionFromChat(item.id, selectionId)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
