'use client';

import {
  DndContext,
  closestCenter,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { SensorDescriptor, SensorOptions } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { Tab } from '../types';

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
    ...(isActive ? { borderColor: 'color-mix(in srgb, var(--foreground) 60%, transparent)' } : {}),
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
          ? 'border-2 text-foreground font-bold'
          : 'border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/5'
      }`}
    >
      <svg className={`w-3 h-3 shrink-0 ${isActive ? 'opacity-80' : 'opacity-50'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isActive ? 2.5 : 1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="max-w-24 truncate" title={tab.name}>{tab.name}</span>
      <span
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-4 h-4 flex items-center justify-center rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity"
        role="button"
        aria-label={`Close ${tab.name}`}
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    </button>
  );
}

function TabOverlay({ tab }: { tab: Tab }) {
  return (
    <div className="flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded text-xs bg-muted text-foreground shadow-lg border border-border">
      <svg className="w-3 h-3 shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="max-w-24 truncate" title={tab.name}>{tab.name}</span>
    </div>
  );
}

export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  sensors: SensorDescriptor<SensorOptions>[];
  activeId: string | null;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e: React.MouseEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onNewTab: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  sensors,
  activeId,
  onSwitchTab,
  onCloseTab,
  onDragStart,
  onDragEnd,
  onNewTab,
}: TabBarProps) {
  return (
    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={tabs.map(t => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex items-center gap-1.5">
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onSelect={() => onSwitchTab(tab.id)}
                onClose={(e) => onCloseTab(tab.id, e)}
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
        onClick={onNewTab}
        className="h-7 w-7 rounded hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors shrink-0"
        title="New Tab"
        aria-label="New tab"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
