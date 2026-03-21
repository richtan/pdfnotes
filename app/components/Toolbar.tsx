'use client';

import { type RefObject } from 'react';
import { TabBar, type TabBarProps } from './TabBar';
import type { Tab } from '../types';

interface ToolbarProps {
  // Tab bar
  tabBarProps: TabBarProps;

  // Page dropdown
  activeTab: Tab | null;
  currentVisiblePage: number;
  isPageDropdownOpen: boolean;
  dropdownRef: RefObject<HTMLDivElement | null>;
  onTogglePageDropdown: () => void;
  onScrollToPage: (page: number) => void;
  chatsPerPage: Map<number, number>;

  // Zoom
  scale: number;
  onZoom: (scale: number) => void;

  // Tools
  isAreaSelectMode: boolean;
  onToggleAreaSelect: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Toolbar({
  tabBarProps,
  activeTab,
  currentVisiblePage,
  isPageDropdownOpen,
  dropdownRef,
  onTogglePageDropdown,
  onScrollToPage,
  chatsPerPage,
  scale,
  onZoom,
  isAreaSelectMode,
  onToggleAreaSelect,
  isDarkMode,
  onToggleDarkMode,
}: ToolbarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="px-4 h-12 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h1 className="text-base font-semibold text-foreground tracking-tight shrink-0">
            PDF Notes
          </h1>

          {/* Divider */}
          <div className="h-4 w-px bg-border shrink-0" />

          {/* Tabs */}
          <TabBar {...tabBarProps} />
        </div>

        {activeTab && (
          <div className="flex items-center gap-1">
            {/* Page dropdown */}
            {activeTab.numPages && activeTab.numPages > 1 && (
              <>
                <div ref={dropdownRef} className="relative">
                  <button
                    onClick={onTogglePageDropdown}
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
                        const chatCount = chatsPerPage.get(pageNum) || 0;
                        const isCurrentPage = pageNum === currentVisiblePage;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => onScrollToPage(pageNum)}
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
                onClick={() => onZoom(Math.max(0.5, scale - 0.1))}
                className="h-8 w-8 rounded-md hover:bg-muted text-foreground flex items-center justify-center transition-colors"
                aria-label="Zoom out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 12H4" />
                </svg>
              </button>
              <span className="text-sm text-foreground min-w-[44px] text-center tabular-nums">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={() => onZoom(Math.min(2, scale + 0.1))}
                className="h-8 w-8 rounded-md hover:bg-muted text-foreground flex items-center justify-center transition-colors"
                aria-label="Zoom in"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* Screenshot tool */}
            <button
              onClick={onToggleAreaSelect}
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
              onClick={onToggleDarkMode}
              className="h-8 w-8 rounded-md hover:bg-muted text-foreground flex items-center justify-center transition-colors"
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
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
  );
}
