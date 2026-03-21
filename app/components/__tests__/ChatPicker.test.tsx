import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPicker } from '../ChatPicker';

describe('ChatPicker', () => {
  it('renders New Chat button', () => {
    render(<ChatPicker onNewChat={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('New Chat')).toBeInTheDocument();
  });

  it('calls onNewChat when button clicked', () => {
    const onNewChat = vi.fn();
    render(<ChatPicker onNewChat={onNewChat} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('New Chat'));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn();
    render(<ChatPicker onNewChat={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
