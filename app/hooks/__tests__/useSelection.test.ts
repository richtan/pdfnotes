import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection, getAllSelectionsFromChat, getPrimarySelection, type ChatMessage, type Selection } from '../useSelection';

const makeSelection = (overrides: Partial<Selection> = {}): Selection => ({
  id: crypto.randomUUID(),
  type: 'text',
  text: 'test text',
  rect: new DOMRect(0, 0, 100, 20),
  pageNumber: 1,
  scale: 1,
  timestamp: Date.now(),
  ...overrides,
});

const makeUserMessage = (content: string, selections?: Selection[]): ChatMessage => ({
  role: 'user',
  content,
  ...(selections ? { selections } : {}),
});

const makeAssistantMessage = (content: string): ChatMessage => ({
  role: 'assistant',
  content,
});

describe('useSelection', () => {
  it('starts with null currentSelection and empty history', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.currentSelection).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.isAreaSelectMode).toBe(false);
  });

  it('setTextSelection creates a text selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setTextSelection('hello', new DOMRect(0, 0, 50, 10), 1);
    });
    expect(result.current.currentSelection).not.toBeNull();
    expect(result.current.currentSelection!.type).toBe('text');
    expect(result.current.currentSelection!.text).toBe('hello');
    expect(result.current.currentSelection!.pageNumber).toBe(1);
  });

  it('setAreaSelection creates an area selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setAreaSelection(new DOMRect(10, 10, 200, 200), 2, 'base64data');
    });
    expect(result.current.currentSelection!.type).toBe('area');
    expect(result.current.currentSelection!.imageBase64).toBe('base64data');
    expect(result.current.currentSelection!.pageNumber).toBe(2);
  });

  it('clearSelection sets currentSelection to null', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setTextSelection('hello', new DOMRect(), 1);
    });
    expect(result.current.currentSelection).not.toBeNull();
    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.currentSelection).toBeNull();
  });

  it('addToHistory stores the provided chat number', () => {
    const { result } = renderHook(() => useSelection());
    const msgs: ChatMessage[] = [makeUserMessage('q1'), makeAssistantMessage('a1')];

    act(() => { result.current.addToHistory(msgs, undefined, 1); });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].chatNumber).toBe(1);

    act(() => { result.current.addToHistory(msgs, undefined, 2); });
    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[1].chatNumber).toBe(2);
  });

  it('addToHistory preserves arbitrary chat numbers', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.addToHistory([makeUserMessage('q')], undefined, 42);
    });
    expect(result.current.history[0].chatNumber).toBe(42);
  });

  it('updateHistoryMessages updates the correct chat', () => {
    const { result } = renderHook(() => useSelection());
    act(() => { result.current.addToHistory([makeUserMessage('q1')], undefined, 1); });
    const chatId = result.current.history[0].id;

    const newMsgs = [makeUserMessage('q1'), makeAssistantMessage('updated')];
    act(() => { result.current.updateHistoryMessages(chatId, newMsgs); });

    expect(result.current.history[0].messages).toHaveLength(2);
    expect(result.current.history[0].messages[1].content).toBe('updated');
  });

  it('removeFromHistory removes the correct chat', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.addToHistory([makeUserMessage('q1')], undefined, 1);
      result.current.addToHistory([makeUserMessage('q2')], undefined, 2);
    });
    expect(result.current.history).toHaveLength(2);

    const firstId = result.current.history[0].id;
    act(() => { result.current.removeFromHistory(firstId); });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].messages[0].content).toBe('q2');
  });

  it('removeSelectionFromChat removes the selection and deletes empty chats', () => {
    const { result } = renderHook(() => useSelection());
    const sel = makeSelection();
    const msgs = [makeUserMessage('q1', [sel])];
    act(() => { result.current.addToHistory(msgs, undefined, 1); });

    const chatId = result.current.history[0].id;
    act(() => { result.current.removeSelectionFromChat(chatId, sel.id); });

    // Chat should be removed since it has no selections left
    expect(result.current.history).toHaveLength(0);
  });

  it('removeSelectionFromChat keeps chat with remaining selections', () => {
    const { result } = renderHook(() => useSelection());
    const sel1 = makeSelection({ id: 'sel-1' });
    const sel2 = makeSelection({ id: 'sel-2' });
    const msgs = [makeUserMessage('q1', [sel1, sel2])];
    act(() => { result.current.addToHistory(msgs, undefined, 1); });

    const chatId = result.current.history[0].id;
    act(() => { result.current.removeSelectionFromChat(chatId, 'sel-1'); });

    expect(result.current.history).toHaveLength(1);
    const remainingSelections = getAllSelectionsFromChat(result.current.history[0]);
    expect(remainingSelections).toHaveLength(1);
    expect(remainingSelections[0].id).toBe('sel-2');
  });

  it('toggleAreaSelectMode toggles and clears selection on enter', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.setTextSelection('hello', new DOMRect(), 1);
    });
    expect(result.current.currentSelection).not.toBeNull();

    act(() => { result.current.toggleAreaSelectMode(); });
    expect(result.current.isAreaSelectMode).toBe(true);
    expect(result.current.currentSelection).toBeNull(); // cleared on enter

    act(() => { result.current.toggleAreaSelectMode(); });
    expect(result.current.isAreaSelectMode).toBe(false);
  });

  it('toggleAreaSelectMode forceOff always turns off', () => {
    const { result } = renderHook(() => useSelection());
    act(() => { result.current.toggleAreaSelectMode(); });
    expect(result.current.isAreaSelectMode).toBe(true);

    act(() => { result.current.toggleAreaSelectMode(true); });
    expect(result.current.isAreaSelectMode).toBe(false);
  });

  it('addToHistory throws when chatNumber is not provided', () => {
    const { result } = renderHook(() => useSelection());
    expect(() => {
      result.current.addToHistory([makeUserMessage('q')]);
    }).toThrow('chatNumber is required');
  });
});

describe('getAllSelectionsFromChat', () => {
  it('flattens selections from all user messages', () => {
    const sel1 = makeSelection({ id: 's1' });
    const sel2 = makeSelection({ id: 's2' });
    const chat = {
      id: 'c1',
      chatNumber: 1,
      messages: [
        makeUserMessage('q1', [sel1]),
        makeAssistantMessage('a1'),
        makeUserMessage('q2', [sel2]),
      ],
    };
    const all = getAllSelectionsFromChat(chat);
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('s1');
    expect(all[1].id).toBe('s2');
  });

  it('returns empty array when no selections', () => {
    const chat = { id: 'c1', chatNumber: 1, messages: [makeUserMessage('q1')] };
    expect(getAllSelectionsFromChat(chat)).toEqual([]);
  });
});

describe('getPrimarySelection', () => {
  it('returns first selection from first user message', () => {
    const sel = makeSelection({ id: 'primary' });
    const chat = {
      id: 'c1',
      chatNumber: 1,
      messages: [makeUserMessage('q1', [sel])],
    };
    expect(getPrimarySelection(chat)?.id).toBe('primary');
  });

  it('returns undefined when no selections exist', () => {
    const chat = { id: 'c1', chatNumber: 1, messages: [makeAssistantMessage('a1')] };
    expect(getPrimarySelection(chat)).toBeUndefined();
  });
});
