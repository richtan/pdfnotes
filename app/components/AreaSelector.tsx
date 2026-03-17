'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AreaSelectorProps {
  containerRef: HTMLDivElement | null;
  pageNumber: number;
  isDarkMode: boolean;
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
  onSelect,
  onCancel,
}: AreaSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);

  // Draw the selection rectangle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only draw overlay and selection when actively drawing
    if (drawingRect) {
      // Draw semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const x = Math.min(drawingRect.startX, drawingRect.currentX);
      const y = Math.min(drawingRect.startY, drawingRect.currentY);
      const width = Math.abs(drawingRect.currentX - drawingRect.startX);
      const height = Math.abs(drawingRect.currentY - drawingRect.startY);

      // Clear the selection area (make it transparent)
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
  }, [drawingRect]);

  // Set canvas size to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef) return;

    canvas.width = containerRef.offsetWidth;
    canvas.height = containerRef.offsetHeight;
  }, [containerRef]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    setDrawingRect({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !drawingRect) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setDrawingRect(prev => prev ? { ...prev, currentX: x, currentY: y } : null);
  }, [isDrawing, drawingRect]);

  const handleMouseUp = useCallback(async () => {
    if (!isDrawing || !drawingRect || !containerRef) {
      setIsDrawing(false);
      setDrawingRect(null);
      return;
    }

    const x = Math.min(drawingRect.startX, drawingRect.currentX);
    const y = Math.min(drawingRect.startY, drawingRect.currentY);
    const width = Math.abs(drawingRect.currentX - drawingRect.startX);
    const height = Math.abs(drawingRect.currentY - drawingRect.startY);

    // Minimum size check - just reset without canceling the mode
    if (width < 10 || height < 10) {
      setIsDrawing(false);
      setDrawingRect(null);
      return;
    }

    // Capture the selected region as an image
    try {
      const pageCanvas = containerRef.querySelector('canvas');
      if (!pageCanvas) {
        throw new Error('PDF canvas not found');
      }

      // Get the scale factor between the display size and the actual canvas size
      const scaleX = pageCanvas.width / containerRef.offsetWidth;
      const scaleY = pageCanvas.height / containerRef.offsetHeight;

      // Create a new canvas for the cropped region
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = width * scaleX;
      croppedCanvas.height = height * scaleY;

      const ctx = croppedCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      // Draw the cropped region
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

      const selectionRect = new DOMRect(x, y, width, height);
      onSelect(selectionRect, pageNumber, imageBase64);
    } catch (error) {
      console.error('Error capturing area:', error);
      onCancel();
    }

    setIsDrawing(false);
    setDrawingRect(null);
  }, [isDrawing, drawingRect, containerRef, pageNumber, onSelect, onCancel]);

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
