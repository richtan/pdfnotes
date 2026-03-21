'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AreaSelectorProps {
  containerRef: HTMLDivElement | null;
  pageNumber: number;
  isDarkMode: boolean;
  scale: number; // Bug G: needed to trigger canvas resize on zoom
  onSelect: (rect: DOMRect, pageNumber: number, imageBase64: string) => void;
  onCancel: () => void;
}

interface DrawingRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function AreaSelector({
  containerRef,
  pageNumber,
  isDarkMode,
  scale,
  onSelect,
  onCancel,
}: AreaSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);
  // Bug L: use ref for guard check to avoid recreating handleMouseMove on every frame
  const isDrawingRef = useRef(false);

  // Draw the selection rectangle
  // Bug H: added isDarkMode to deps so colors update on toggle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Bug J: account for DPI scaling
    const dpr = window.devicePixelRatio || 1;

    // Clear canvas (use full canvas dimensions)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    if (drawingRect) {
      // Draw semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      const x = Math.min(drawingRect.startX, drawingRect.currentX);
      const y = Math.min(drawingRect.startY, drawingRect.currentY);
      const width = Math.abs(drawingRect.currentX - drawingRect.startX);
      const height = Math.abs(drawingRect.currentY - drawingRect.startY);

      // Clear the selection area
      ctx.clearRect(x, y, width, height);

      // Draw border
      ctx.strokeStyle = isDarkMode ? '#18181b' : '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, width, height);

      // Draw corner handles
      const handleSize = 6;
      ctx.fillStyle = isDarkMode ? '#18181b' : '#3b82f6';
      ctx.setLineDash([]);
      ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
      ctx.fillRect(x + width - handleSize/2, y - handleSize/2, handleSize, handleSize);
      ctx.fillRect(x - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
      ctx.fillRect(x + width - handleSize/2, y + height - handleSize/2, handleSize, handleSize);
    }
  }, [drawingRect, isDarkMode]);

  // Set canvas size to match container
  // Bug G: added scale to deps so canvas resizes on zoom
  // Bug J: scale canvas for devicePixelRatio (Retina)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef) return;

    const dpr = window.devicePixelRatio || 1;
    const w = containerRef.offsetWidth;
    const h = containerRef.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  }, [containerRef, scale]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    isDrawingRef.current = true;
    setDrawingRect({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  }, []);

  // Bug L: stable callback — uses ref for guard, functional setState for update
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setDrawingRect(prev => prev ? { ...prev, currentX: x, currentY: y } : null);
  }, []);

  const handleMouseUp = useCallback(async () => {
    if (!isDrawingRef.current || !drawingRect || !containerRef) {
      isDrawingRef.current = false;
      setDrawingRect(null);
      return;
    }

    const x = Math.min(drawingRect.startX, drawingRect.currentX);
    const y = Math.min(drawingRect.startY, drawingRect.currentY);
    const width = Math.abs(drawingRect.currentX - drawingRect.startX);
    const height = Math.abs(drawingRect.currentY - drawingRect.startY);

    // Minimum size check
    if (width < 10 || height < 10) {
      isDrawingRef.current = false;
      setDrawingRect(null);
      return;
    }

    try {
      const pageCanvas = containerRef.querySelector('canvas');
      if (!pageCanvas) {
        throw new Error('PDF canvas not found');
      }

      const scaleX = pageCanvas.width / containerRef.offsetWidth;
      const scaleY = pageCanvas.height / containerRef.offsetHeight;

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = width * scaleX;
      croppedCanvas.height = height * scaleY;

      const ctx = croppedCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(
        pageCanvas,
        x * scaleX,
        y * scaleY,
        width * scaleX,
        height * scaleY,
        0,
        0,
        croppedCanvas.width,
        croppedCanvas.height
      );

      const imageBase64 = croppedCanvas.toDataURL('image/png');

      // Bug O: release temp canvas memory immediately
      croppedCanvas.width = 0;
      croppedCanvas.height = 0;

      const selectionRect = new DOMRect(x, y, width, height);
      onSelect(selectionRect, pageNumber, imageBase64);
    } catch (error) {
      console.error('Error capturing area:', error);
      onCancel();
    }

    isDrawingRef.current = false;
    setDrawingRect(null);
  }, [drawingRect, containerRef, pageNumber, onSelect, onCancel]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onCancel]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-20 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
