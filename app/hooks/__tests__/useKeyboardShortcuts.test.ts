import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useKeyboardShortcuts', () => {
  const makeHandlers = () => ({
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onToggleAreaSelect: vi.fn(),
    onClearSelection: vi.fn(),
  });

  it('Cmd+Shift+] calls onNextTab', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));
    fireKey(']', { metaKey: true, shiftKey: true });
    expect(handlers.onNextTab).toHaveBeenCalledOnce();
  });

  it('Cmd+Shift+[ calls onPrevTab', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('[', { metaKey: true, shiftKey: true });
    expect(handlers.onPrevTab).toHaveBeenCalledOnce();
  });

  it('Ctrl+Shift+] also works (non-Mac)', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));
    fireKey(']', { ctrlKey: true, shiftKey: true });
    expect(handlers.onNextTab).toHaveBeenCalledOnce();
  });

  it('Cmd+Shift+A calls onToggleAreaSelect', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('A', { metaKey: true, shiftKey: true });
    expect(handlers.onToggleAreaSelect).toHaveBeenCalledOnce();
  });

  it('Escape calls onClearSelection', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('Escape');
    expect(handlers.onClearSelection).toHaveBeenCalledOnce();
  });

  it('Escape does NOT fire when input is focused', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // The handler checks e.target.tagName === 'INPUT', but since we dispatch on the input,
    // the event should still reach window but with target=input
    // Actually the target is set by the DOM — dispatching on input sets target to input
    expect(handlers.onClearSelection).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('ignores shortcuts without modifier when input is focused', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, shiftKey: true, bubbles: true }));
    expect(handlers.onNextTab).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('ignores ] without Shift modifier', () => {
    const handlers = makeHandlers();
    renderHook(() => useKeyboardShortcuts(handlers));
    fireKey(']', { metaKey: true }); // no shiftKey
    expect(handlers.onNextTab).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    unmount();
    fireKey(']', { metaKey: true, shiftKey: true });
    expect(handlers.onNextTab).not.toHaveBeenCalled();
  });
});
