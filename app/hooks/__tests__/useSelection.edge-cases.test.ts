import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection, getAllSelectionsFromChat, type ChatMessage, type Selection } from '../useSelection';

const makeSelection = (overrides: Partial<Selection> = {}): Selection => ({
  id: crypto.randomUUID(),
  type: 'text',
  text: 'test',
  rect: new DOMRect(0, 0, 100, 20),
  pageNumber: 1,
  scale: 1,
  timestamp: Date.now(),
  ...overrides,
});

const makeUserMsg = (content: string, selections?: Selection[]): ChatMessage => ({
  role: 'user',
  content,
  ...(selections ? { selections } : {}),
});

describe('useSelection edge cases', () => {
  it('removeSelectionFromChat is idempotent (same ID twice)', () => {
    const { result } = renderHook(() => useSelection());
    const sel = makeSelection({ id: 'sel-1' });

    act(() => {
      result.current.addToHistory([makeUserMsg('q', [sel])], undefined, 1);
    });
    const chatId = result.current.history[0].id;

    act(() => { result.current.removeSelectionFromChat(chatId, 'sel-1'); });
    expect(result.current.history).toHaveLength(0);

    // Second removal should be a no-op (chat already gone)
    act(() => { result.current.removeSelectionFromChat(chatId, 'sel-1'); });
    expect(result.current.history).toHaveLength(0);
  });

  it('removeSelectionFromChat: 2 selections → remove 1 → 1 remains', () => {
    const { result } = renderHook(() => useSelection());
    const sel1 = makeSelection({ id: 'a' });
    const sel2 = makeSelection({ id: 'b' });

    act(() => {
      result.current.addToHistory([makeUserMsg('q', [sel1, sel2])], undefined, 1);
    });
    const chatId = result.current.history[0].id;

    act(() => { result.current.removeSelectionFromChat(chatId, 'a'); });
    expect(result.current.history).toHaveLength(1);

    const remaining = getAllSelectionsFromChat(result.current.history[0]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('b');
  });

  it('toggleAreaSelectMode(false) when already off is a no-op', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.isAreaSelectMode).toBe(false);

    act(() => { result.current.toggleAreaSelectMode(true); }); // forceOff
    expect(result.current.isAreaSelectMode).toBe(false);
  });

  it('addToHistory stores the provided chatNumber', () => {
    const { result } = renderHook(() => useSelection());

    act(() => { result.current.addToHistory([makeUserMsg('q1')], undefined, 99); });
    expect(result.current.history[0].chatNumber).toBe(99);

    act(() => { result.current.addToHistory([makeUserMsg('q2')], undefined, 100); });
    expect(result.current.history[1].chatNumber).toBe(100);
  });

  it('setTextSelection stores scale parameter', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setTextSelection('text', new DOMRect(), 1, undefined, undefined, 1.5);
    });
    expect(result.current.currentSelection!.scale).toBe(1.5);
  });

  it('setAreaSelection defaults text to empty string', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setAreaSelection(new DOMRect(), 1, 'base64');
    });
    expect(result.current.currentSelection!.text).toBe('');
  });

  it('each selection gets a unique id', () => {
    const { result } = renderHook(() => useSelection());
    act(() => { result.current.setTextSelection('a', new DOMRect(), 1); });
    const id1 = result.current.currentSelection!.id;

    act(() => { result.current.setTextSelection('b', new DOMRect(), 1); });
    const id2 = result.current.currentSelection!.id;

    expect(id1).not.toBe(id2);
  });
});
