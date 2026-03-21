'use client';

import { AIPopover } from './AIPopover';
import { getAllSelectionsFromChat, getPrimarySelection } from '../hooks/useSelection';
import type { Selection, ChatMessage, HistoryItem } from '../hooks/useSelection';
import { EXPAND_CURRENT, SIDEBAR_WIDTH_PERCENT } from '../types';

interface ChatSidebarProps {
  currentSelection: Selection | null;
  currentChatNumber: number | null;
  expandedChatId: string;
  viewportHeight: number;
  generatingSelections: Map<string, { selection: Selection; messages: ChatMessage[]; chatNumber: number }>;
  history: HistoryItem[];
  getSelectionYPosition: (sel: { pageNumber: number; rect: DOMRect; scale?: number }) => number;
  onPopoverClose: () => void;
  onCurrentMessagesUpdate: (messages: ChatMessage[]) => void;
  onToggleExpand: (chatId: string) => void;
  onCurrentLoadingChange: (loading: boolean) => void;
  onRemoveGenerating: (selectionId: string) => void;
  onGeneratingMessagesUpdate: (selectionId: string, messages: ChatMessage[]) => void;
  onGeneratingLoadingChange: (selectionId: string, loading: boolean) => void;
  onRemoveHistory: (chatId: string) => void;
  onUpdateHistoryMessages: (chatId: string, messages: ChatMessage[]) => void;
  onRemoveSelectionFromChat: (chatId: string, selectionId: string) => void;
}

export function ChatSidebar({
  currentSelection,
  currentChatNumber,
  expandedChatId,
  viewportHeight,
  generatingSelections,
  history,
  getSelectionYPosition,
  onPopoverClose,
  onCurrentMessagesUpdate,
  onToggleExpand,
  onCurrentLoadingChange,
  onRemoveGenerating,
  onGeneratingMessagesUpdate,
  onGeneratingLoadingChange,
  onRemoveHistory,
  onUpdateHistoryMessages,
  onRemoveSelectionFromChat,
}: ChatSidebarProps) {
  return (
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
            onClose={onPopoverClose}
            onMessagesUpdate={onCurrentMessagesUpdate}
            onToggleMinimize={() => onToggleExpand(expandedChatId === EXPAND_CURRENT ? 'none' : EXPAND_CURRENT)}
            onLoadingChange={onCurrentLoadingChange}
          />
        </div>
      )}

      {/* Background generating selections */}
      {Array.from(generatingSelections.values()).map(({ selection, messages, chatNumber: genChatNumber }) => (
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
            chatNumber={genChatNumber}
            isMinimized={expandedChatId !== selection.id}
            initialMessages={messages}
            onClose={() => onRemoveGenerating(selection.id)}
            onMessagesUpdate={(msgs) => onGeneratingMessagesUpdate(selection.id, msgs)}
            onToggleMinimize={() => onToggleExpand(expandedChatId === selection.id ? 'none' : selection.id)}
            onLoadingChange={(loading) => {
              if (!loading) {
                onGeneratingLoadingChange(selection.id, loading);
              }
            }}
          />
        </div>
      ))}

      {/* History items */}
      {history.map((item) => {
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
              onClose={() => onRemoveHistory(item.id)}
              onMessagesUpdate={(messages) => onUpdateHistoryMessages(item.id, messages)}
              onToggleMinimize={() => onToggleExpand(expandedChatId === item.id ? 'none' : item.id)}
              onRemoveSelection={(selectionId) => onRemoveSelectionFromChat(item.id, selectionId)}
            />
          </div>
        );
      })}
    </div>
  );
}
