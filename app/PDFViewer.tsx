'use client';

import { useCallback, useId, useMemo, useState, useRef, useEffect } from 'react';
import { useResizeObserver } from '@wojtekmaj/react-hooks';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useSelection, getPrimarySelection } from './hooks/useSelection';
import type { ChatMessage, Selection, HistoryItem } from './hooks/useSelection';
import { AreaSelector } from './components/AreaSelector';
import { ChatPicker } from './components/ChatPicker';
import { EmptyTabView } from './components/EmptyTabView';
import { SelectionHighlights } from './components/SelectionHighlights';
import { Toolbar } from './components/Toolbar';
import { ChatSidebar } from './components/ChatSidebar';
import { type Tab, createEmptyTab, MAX_FILE_SIZE, PDF_WIDTH_PERCENT, SIDEBAR_WIDTH_PERCENT, EXPAND_CURRENT } from './types';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const options = {
  cMapUrl: '/cmaps/',
  standardFontDataUrl: '/standard_fonts/',
};

const resizeObserverOptions = {};

const initialTab = createEmptyTab();

export default function PDFViewer() {
  const fileId = useId();

  // Tab state - start with one empty tab
  const [tabs, setTabs] = useState<Tab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialTab.id);

  const [scale, setScale] = useState(1);
  const [containerRef, setContainerRef] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pdfnotes-dark-mode');
      if (saved !== null) return saved === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true; // SSR fallback — dark is safer to avoid flash
  });
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
  const [generatingSelections, setGeneratingSelections] = useState<Map<string, { selection: Selection; messages: ChatMessage[]; chatNumber: number }>>(new Map());
  // Safety timeouts to clean up generating selections that hang (Bug C)
  const generatingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Derive next chat number from existing data (no stored counter — avoids skipping/double-increment)
  const getNextChatNumber = useCallback(() => {
    let max = 0;
    for (const item of history) {
      if (item.chatNumber > max) max = item.chatNumber;
    }
    if (currentChatNumber != null && currentChatNumber > max) max = currentChatNumber;
    for (const gen of generatingSelections.values()) {
      if (gen.chatNumber > max) max = gen.chatNumber;
    }
    return max + 1;
  }, [history, currentChatNumber, generatingSelections]);

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

  // Persist dark mode preference and sync to <html> element (Bug K: matches layout.tsx FOUC script)
  useEffect(() => {
    localStorage.setItem('pdfnotes-dark-mode', String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Calculate chat count per page (Bug F: useMemo instead of useCallback)
  const chatsPerPage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of history) {
      const primarySel = getPrimarySelection(item);
      if (primarySel) {
        const page = primarySel.pageNumber;
        counts.set(page, (counts.get(page) || 0) + 1);
      }
    }
    if (currentSelection) {
      const page = currentSelection.pageNumber;
      counts.set(page, (counts.get(page) || 0) + 1);
    }
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
        if (rect.height < 50) return; // Page canvas hasn't rendered yet
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

  // Close page dropdown on Escape
  useEffect(() => {
    if (!isPageDropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPageDropdownOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
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

    // Restore scroll position after layout completes (double rAF for reliability)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, tab.scrollY);
      });
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

    const fileArray = Array.from(files).filter(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 100MB.`);
        return false;
      }
      return true;
    });
    if (fileArray.length === 0) return;
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

    try {
      new URL(url);
    } catch {
      alert('Please enter a valid URL (e.g., https://example.com/document.pdf)');
      return;
    }

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
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
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
    ).filter(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 100MB.`);
        return false;
      }
      return true;
    });

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
        scale,
        timestamp: Date.now(),
      };

      // Set as pending selection (user will choose which chat to add it to)
      setPendingSelection(newSelection);
    }
  }, [isAreaSelectMode, scale]);

  const handleAreaSelect = useCallback((rect: DOMRect, pageNumber: number, imageBase64: string) => {
    // Create the new selection object
    const newSelection: Selection = {
      id: crypto.randomUUID(),
      type: 'area',
      text: '',
      rect,
      pageNumber,
      imageBase64,
      scale,
      timestamp: Date.now(),
    };

    // Set as pending selection (user will choose which chat to add it to)
    setPendingSelection(newSelection);
    toggleAreaSelectMode(true); // Force off
  }, [toggleAreaSelectMode, scale]);

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
        const selId = currentSelection.id;
        setGeneratingSelections(prev => {
          const next = new Map(prev);
          next.set(selId, {
            selection: currentSelection,
            messages: [...currentMessagesRef.current],
            chatNumber: currentChatNumber ?? 0,
          });
          return next;
        });
        // Safety timeout: clean up if generation hangs for 5 minutes (Bug C)
        const timeout = setTimeout(() => {
          setGeneratingSelections(prev => {
            if (!prev.has(selId)) return prev;
            const next = new Map(prev);
            next.delete(selId);
            return next;
          });
          generatingTimeoutsRef.current.delete(selId);
        }, 5 * 60 * 1000);
        generatingTimeoutsRef.current.set(selId, timeout);
      } else {
        // Not generating, move directly to history (with current chat number)
        addToHistory(currentMessagesRef.current, undefined, currentChatNumber ?? 0);
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
      addToHistory(currentMessagesRef.current, undefined, currentChatNumber ?? 0);
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
    // Clear safety timeout (Bug C)
    const existingTimeout = generatingTimeoutsRef.current.get(selectionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      generatingTimeoutsRef.current.delete(selectionId);
    }
    setGeneratingSelections(prev => {
      const item = prev.get(selectionId);
      if (item) {
        addToHistory(messages, undefined, item.chatNumber);
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

  // Handlers for ChatSidebar's generating selections
  const handleRemoveGenerating = useCallback((selectionId: string) => {
    const existingTimeout = generatingTimeoutsRef.current.get(selectionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      generatingTimeoutsRef.current.delete(selectionId);
    }
    setGeneratingSelections(prev => {
      const next = new Map(prev);
      next.delete(selectionId);
      return next;
    });
  }, []);

  const handleGeneratingLoadingDone = useCallback((selectionId: string) => {
    setGeneratingSelections(prev => {
      const genItem = prev.get(selectionId);
      if (genItem) {
        handleGeneratingComplete(selectionId, genItem.messages);
      }
      return prev;
    });
  }, [handleGeneratingComplete]);

  // Zoom handler that preserves scroll position
  const handleZoom = useCallback((newScale: number) => {
    const scrollY = window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    const scrollRatio = docHeight > 0 ? scrollY / docHeight : 0;
    setScale(newScale);
    requestAnimationFrame(() => {
      const newDocHeight = document.documentElement.scrollHeight;
      window.scrollTo(0, scrollRatio * newDocHeight);
    });
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
  const getSelectionYPosition = useCallback((selection: { pageNumber: number; rect: DOMRect; scale?: number }) => {
    let offsetTop = 0;
    // Add heights of all pages before this one (plus 24px gap between pages — gap-6 = 1.5rem = 24px)
    for (let i = 1; i < selection.pageNumber; i++) {
      const pageRef = pageRefs.current.get(i);
      if (pageRef) {
        offsetTop += pageRef.offsetHeight + 24;
      }
    }
    // Add the selection's position within its page (adjusted for zoom changes)
    const zoomRatio = selection.scale ? scale / selection.scale : 1;
    offsetTop += selection.rect.y * zoomRatio;
    return offsetTop;
  }, [scale]);

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

    const pageRef = pageRefs.current.get(anchorPageNum);
    if (!pageRef || !containerRef) return { top: 0, left: 0, showAbove: false };

    const PICKER_HEIGHT = 44; // actual rendered height of the single-button picker
    const PICKER_WIDTH = 256; // w-64
    const HEADER_HEIGHT = 48; // h-12 sticky header
    const GAP = 8;

    // Use live DOM measurements for accurate positioning
    const pageBounds = pageRef.getBoundingClientRect();
    const containerBounds = containerRef.getBoundingClientRect();

    // Selection position in screen/viewport coordinates
    const selScreenTop = pageBounds.top + anchorRect.y;
    const selScreenBottom = selScreenTop + anchorRect.height;
    const selScreenCenterX = pageBounds.left + anchorRect.x + anchorRect.width / 2;

    // Use live viewport height for accuracy
    const vpHeight = window.innerHeight;

    // Check viewport fit
    const fitsBelow = selScreenBottom + GAP + PICKER_HEIGHT <= vpHeight;
    const fitsAbove = selScreenTop - GAP - PICKER_HEIGHT >= HEADER_HEIGHT;

    // Choose direction; if neither fits, center picker on the selection
    let showAbove = false;
    let screenY: number;
    if (fitsBelow) {
      screenY = selScreenBottom + GAP;
    } else if (fitsAbove) {
      showAbove = true;
      screenY = selScreenTop - GAP; // translateY(-100%) will push it above this point
    } else {
      // Neither fits — center on the selection (OK to cover it)
      screenY = (selScreenTop + selScreenBottom) / 2 - PICKER_HEIGHT / 2;
    }

    // Final safety clamp: guarantee picker stays within visible viewport
    if (showAbove) {
      // Picker extends upward from screenY (translateY(-100%)), so it occupies [screenY - PICKER_HEIGHT, screenY]
      screenY = Math.max(HEADER_HEIGHT + GAP + PICKER_HEIGHT, Math.min(screenY, vpHeight - GAP));
    } else {
      // Picker extends downward from screenY, so it occupies [screenY, screenY + PICKER_HEIGHT]
      screenY = Math.max(HEADER_HEIGHT + GAP, Math.min(screenY, vpHeight - PICKER_HEIGHT - GAP));
    }

    // Convert screen coordinates to container-relative for absolute positioning
    const top = screenY - containerBounds.top;

    // Horizontal: center on selection, clamped to container bounds
    const relCenterX = selScreenCenterX - containerBounds.left;
    const left = Math.max(
      PICKER_WIDTH / 2, // don't go off left edge (translateX(-50%))
      Math.min(relCenterX, containerBounds.width - PICKER_WIDTH / 2)
    );

    return { top, left, showAbove };
  }, [containerRef, viewportHeight]);

  // Keyboard shortcuts (must be after all callbacks are defined)
  useKeyboardShortcuts(useMemo(() => ({
    onNextTab: () => {
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx >= 0 && idx < tabs.length - 1) switchToTab(tabs[idx + 1].id);
    },
    onPrevTab: () => {
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx > 0) switchToTab(tabs[idx - 1].id);
    },
    onToggleAreaSelect: () => toggleAreaSelectMode(),
    onClearSelection: () => {
      if (pendingSelection) {
        setPendingSelection(null);
        return;
      }
      setExpandedChatId('none');
    },
  }), [tabs, activeTabId, switchToTab, toggleAreaSelectMode, pendingSelection]));

  return (
    <div
      className="min-h-screen bg-background"
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
      <Toolbar
        tabBarProps={{
          tabs,
          activeTabId,
          sensors,
          activeId,
          onSwitchTab: switchToTab,
          onCloseTab: closeTab,
          onDragStart: handleDragStart,
          onDragEnd: handleDragEnd,
          onNewTab: () => {
            saveCurrentTabState();
            const newTab = createEmptyTab();
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(newTab.id);
            setHistory([]);
            setCurrentSelection(null);
            currentMessagesRef.current = [];
            setExpandedChatId(EXPAND_CURRENT);
            setUrlInput('');
          },
        }}
        activeTab={activeTab}
        currentVisiblePage={currentVisiblePage}
        isPageDropdownOpen={isPageDropdownOpen}
        dropdownRef={dropdownRef}
        onTogglePageDropdown={() => setIsPageDropdownOpen(!isPageDropdownOpen)}
        onScrollToPage={scrollToPage}
        chatsPerPage={chatsPerPage}
        scale={scale}
        onZoom={handleZoom}
        isAreaSelectMode={isAreaSelectMode}
        onToggleAreaSelect={() => toggleAreaSelectMode()}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(d => !d)}
      />


      {/* Main content */}
      <main className="relative">
        {!activeTab || !activeTab.file ? (
          /* Empty tab - show upload UI */
          <EmptyTabView
            fileId={fileId}
            onFileChange={onFileChange}
            urlInput={urlInput}
            onUrlInputChange={setUrlInput}
            onUrlSubmit={onUrlSubmit}
          />
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
              {tabs.filter(tab => tab.file && tab.id === activeTabId).map((tab) => {
                return (
                  <div key={tab.id}>
                    {/* Bug I fix: only mount active tab's PDF to save memory */}
                    {tab.loadError ? (
                      <div className="flex flex-col items-center justify-center py-32 text-center">
                        <svg className="w-12 h-12 text-destructive mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <p className="text-foreground font-medium mb-1">Failed to load PDF</p>
                        <p className="text-sm text-muted-foreground mb-4 max-w-sm">{tab.loadError}</p>
                        <button
                          onClick={() => {
                            setTabs(prev => prev.map(t =>
                              t.id === tab.id ? { ...t, loadError: undefined, file: t.file } : t
                            ));
                          }}
                          className="h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                    <Document
                      file={tab.file}
                      onLoadSuccess={onDocumentLoadSuccess(tab.id)}
                      onLoadError={(error) => {
                        setTabs(prev => prev.map(t =>
                          t.id === tab.id ? { ...t, loadError: error.message } : t
                        ));
                      }}
                      options={options}
                      className="flex flex-col items-center gap-6"
                      loading={
                        <div className="flex items-center justify-center py-32">
                          <svg className="w-6 h-6 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      }
                    >
                      {tab.numPages ? Array.from(new Array(tab.numPages), (_el, index) => {
                        const pageNum = index + 1;
                        return (
                          <div
                            key={`page_${pageNum}`}
                            ref={setPageRef(pageNum)}
                            className="relative shadow-sm ring-1 ring-border/50 rounded-lg overflow-hidden bg-white"
                          >
                            <Page
                              pageNumber={pageNum}
                              width={pageWidth}
                              renderTextLayer={true}
                              renderAnnotationLayer={true}
                              canvasBackground="white"
                            />

                            {/* Area selector overlay */}
                            {isAreaSelectMode && (
                              <AreaSelector
                                containerRef={pageRefs.current.get(pageNum) || null}
                                pageNumber={pageNum}
                                isDarkMode={isDarkMode}
                                scale={scale}
                                onSelect={handleAreaSelect}
                                onCancel={handleAreaCancel}
                              />
                            )}

                            {/* Selection highlights */}
                            <SelectionHighlights
                              pageNum={pageNum}
                              scale={scale}
                              currentSelection={currentSelection}
                              pendingSelection={pendingSelection}
                              expandedChatId={expandedChatId}
                              currentChatNumber={currentChatNumber}
                              history={history}
                              generatingSelections={generatingSelections}
                              onExpandChat={setExpandedChatId}
                            />
                          </div>
                        );
                      }) : null}
                    </Document>
                    )}
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

            {/* Comments sidebar */}
            <ChatSidebar
              currentSelection={currentSelection}
              currentChatNumber={currentChatNumber}
              expandedChatId={expandedChatId}
              viewportHeight={viewportHeight}
              generatingSelections={generatingSelections}
              history={history}
              getSelectionYPosition={getSelectionYPosition}
              onPopoverClose={handlePopoverClose}
              onCurrentMessagesUpdate={handleCurrentMessagesUpdate}
              onToggleExpand={setExpandedChatId}
              onCurrentLoadingChange={handleCurrentLoadingChange}
              onRemoveGenerating={handleRemoveGenerating}
              onGeneratingMessagesUpdate={handleGeneratingMessagesUpdate}
              onGeneratingLoadingChange={handleGeneratingLoadingDone}
              onRemoveHistory={removeFromHistory}
              onUpdateHistoryMessages={updateHistoryMessages}
              onRemoveSelectionFromChat={removeSelectionFromChat}
            />
          </div>
        )}
      </main>
    </div>
  );
}
