'use client';

import { useCallback, useEffect, useRef } from 'react';

interface SelectionLayerProps {
  pageNumber: number;
  containerRef: HTMLDivElement | null;
  onTextSelect: (text: string, rect: DOMRect, pageNumber: number) => void;
  isAreaSelectMode: boolean;
  onAreaSelectStart: () => void;
}

export function SelectionLayer({
  pageNumber,
  containerRef,
  onTextSelect,
  isAreaSelectMode,
  onAreaSelectStart,
}: SelectionLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback(() => {
    if (isAreaSelectMode) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Check if the selection is within this page's container
    if (containerRef && layerRef.current) {
      const containerRect = containerRef.getBoundingClientRect();
      const relativeRect = new DOMRect(
        rect.x - containerRect.x,
        rect.y - containerRect.y,
        rect.width,
        rect.height
      );
      onTextSelect(text, relativeRect, pageNumber);
    }
  }, [containerRef, isAreaSelectMode, onTextSelect, pageNumber]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    layer.addEventListener('mouseup', handleMouseUp);
    return () => {
      layer.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseUp]);

  const handleClick = useCallback(() => {
    if (isAreaSelectMode) {
      onAreaSelectStart();
    }
  }, [isAreaSelectMode, onAreaSelectStart]);

  return (
    <div
      ref={layerRef}
      className={`absolute inset-0 z-10 ${
        isAreaSelectMode ? 'cursor-crosshair' : ''
      }`}
      onClick={handleClick}
      style={{ pointerEvents: isAreaSelectMode ? 'auto' : 'none' }}
    />
  );
}
