import { useEffect } from 'react';

interface KeyboardShortcutHandlers {
  onNextTab: () => void;
  onPrevTab: () => void;
  onToggleAreaSelect: () => void;
  onClearSelection: () => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Escape: only when not typing in an input
      // AIPopover and ChatPicker have their own Escape handlers
      if (e.key === 'Escape' && !isInput) {
        handlers.onClearSelection();
        return;
      }

      // Skip other shortcuts when typing in inputs
      if (isInput) return;

      // Cmd+Shift+] / Cmd+Shift+[ — switch tabs (matches Chrome tab shortcuts)
      if (mod && e.shiftKey && e.key === ']') {
        e.preventDefault();
        handlers.onNextTab();
      }
      if (mod && e.shiftKey && e.key === '[') {
        e.preventDefault();
        handlers.onPrevTab();
      }
      // Cmd+Shift+A — toggle area select
      if (mod && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        handlers.onToggleAreaSelect();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
