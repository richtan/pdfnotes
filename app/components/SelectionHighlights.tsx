'use client';

import type { Selection, ChatMessage, HistoryItem } from '../hooks/useSelection';
import { getAllSelectionsFromChat } from '../hooks/useSelection';
import { EXPAND_CURRENT } from '../types';

const CHAT_COLORS = [
  { focused: 'bg-blue-500/30', unfocused: 'bg-blue-400/15 hover:bg-blue-400/25', areaFocused: 'border-blue-500 bg-blue-500/10', areaUnfocused: 'border-blue-400/50 bg-blue-400/5 hover:bg-blue-400/10' },
  { focused: 'bg-violet-500/30', unfocused: 'bg-violet-400/15 hover:bg-violet-400/25', areaFocused: 'border-violet-500 bg-violet-500/10', areaUnfocused: 'border-violet-400/50 bg-violet-400/5 hover:bg-violet-400/10' },
  { focused: 'bg-emerald-500/30', unfocused: 'bg-emerald-400/15 hover:bg-emerald-400/25', areaFocused: 'border-emerald-500 bg-emerald-500/10', areaUnfocused: 'border-emerald-400/50 bg-emerald-400/5 hover:bg-emerald-400/10' },
  { focused: 'bg-rose-500/30', unfocused: 'bg-rose-400/15 hover:bg-rose-400/25', areaFocused: 'border-rose-500 bg-rose-500/10', areaUnfocused: 'border-rose-400/50 bg-rose-400/5 hover:bg-rose-400/10' },
];

interface SelectionHighlightsProps {
  pageNum: number;
  scale: number;
  currentSelection: Selection | null;
  pendingSelection: Selection | null;
  expandedChatId: string;
  currentChatNumber: number | null;
  history: HistoryItem[];
  generatingSelections: Map<string, { selection: Selection; messages: ChatMessage[]; chatNumber: number }>;
  onExpandChat: (chatId: string) => void;
}

export function SelectionHighlights({
  pageNum,
  scale,
  currentSelection,
  pendingSelection,
  expandedChatId,
  currentChatNumber,
  history,
  generatingSelections,
  onExpandChat,
}: SelectionHighlightsProps) {
  const hasRectsOnPage = (sel: Selection | null) => {
    if (!sel) return false;
    if (sel.rectsByPage?.has(pageNum)) return true;
    return sel.pageNumber === pageNum;
  };

  const getRectsForPage = (sel: Selection) => {
    if (sel.rectsByPage?.has(pageNum)) {
      return sel.rectsByPage.get(pageNum)!;
    }
    if (sel.pageNumber === pageNum) {
      return sel.rects || [sel.rect];
    }
    return [];
  };

  const selectionsToHighlight: Array<{
    selection: Selection | null;
    isFocused: boolean;
    isPending?: boolean;
    chatId?: string;
    chatNumber?: number;
  }> = [];
  const renderedIds = new Set<string>();

  // Pending selection
  if (pendingSelection && hasRectsOnPage(pendingSelection) && !renderedIds.has(pendingSelection.id)) {
    renderedIds.add(pendingSelection.id);
    selectionsToHighlight.push({ selection: pendingSelection, isFocused: true, isPending: true });
  }

  // Current selection
  if (currentSelection && hasRectsOnPage(currentSelection) && !renderedIds.has(currentSelection.id)) {
    renderedIds.add(currentSelection.id);
    selectionsToHighlight.push({
      selection: currentSelection,
      isFocused: expandedChatId === EXPAND_CURRENT,
      chatNumber: currentChatNumber ?? 0,
    });
  }

  // History items
  history.forEach(item => {
    const allSelections = getAllSelectionsFromChat(item);
    allSelections.forEach(sel => {
      if (hasRectsOnPage(sel) && !renderedIds.has(sel.id)) {
        renderedIds.add(sel.id);
        selectionsToHighlight.push({
          selection: sel,
          isFocused: expandedChatId === item.id,
          chatId: item.id,
          chatNumber: item.chatNumber,
        });
      }
    });
  });

  // Generating selections
  generatingSelections.forEach(({ selection: genSelection, chatNumber: genChatNum }) => {
    if (hasRectsOnPage(genSelection) && !renderedIds.has(genSelection.id)) {
      renderedIds.add(genSelection.id);
      selectionsToHighlight.push({
        selection: genSelection,
        isFocused: expandedChatId === genSelection.id,
        chatNumber: genChatNum,
      });
    }
  });

  return (
    <>
      {selectionsToHighlight.map(({ selection, isFocused, isPending, chatId, chatNumber: cn }) => {
        if (!selection) return null;

        const handleMouseDown = (e: React.MouseEvent) => {
          e.stopPropagation();
        };
        const handleClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (isPending) return;
          const isCurrentSel = currentSelection?.id === selection.id;
          onExpandChat(isCurrentSel ? EXPAND_CURRENT : (chatId || selection.id));
        };

        const zoomRatio = selection.scale ? scale / selection.scale : 1;
        const colorIdx = (cn ?? 0) % CHAT_COLORS.length;
        const colors = CHAT_COLORS[colorIdx];

        const getAreaClass = () => {
          if (isPending) return 'border-dashed border-2 border-amber-500 bg-amber-500/10';
          if (isFocused) return `${colors.areaFocused}`;
          return `${colors.areaUnfocused}`;
        };

        const getTextClass = () => {
          if (isPending) return 'bg-amber-500/20';
          if (isFocused) return colors.focused;
          return colors.unfocused;
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
                left: selection.rect.x * zoomRatio,
                top: selection.rect.y * zoomRatio,
                width: selection.rect.width * zoomRatio,
                height: selection.rect.height * zoomRatio,
              }}
            />
          );
        } else {
          const rectsForThisPage = getRectsForPage(selection);
          return rectsForThisPage.map((r, i) => (
            <div
              key={`${selection.id}-${pageNum}-${i}`}
              data-selection-highlight
              onMouseDown={handleMouseDown}
              onClick={handleClick}
              className={`absolute cursor-pointer transition-colors z-10 ${getTextClass()}`}
              style={{
                left: r.x * zoomRatio,
                top: r.y * zoomRatio,
                width: r.width * zoomRatio,
                height: r.height * zoomRatio,
              }}
            />
          ));
        }
      })}
    </>
  );
}
