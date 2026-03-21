import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyTabView } from '../EmptyTabView';

const defaultProps = {
  fileId: 'test-file-id',
  onFileChange: vi.fn(),
  urlInput: '',
  onUrlInputChange: vi.fn(),
  onUrlSubmit: vi.fn(),
};

describe('EmptyTabView', () => {
  it('renders upload button', () => {
    render(<EmptyTabView {...defaultProps} />);
    expect(screen.getByText('Upload PDF')).toBeInTheDocument();
  });

  it('renders URL input', () => {
    render(<EmptyTabView {...defaultProps} />);
    expect(screen.getByPlaceholderText('Paste PDF URL...')).toBeInTheDocument();
  });

  it('renders heading and description', () => {
    render(<EmptyTabView {...defaultProps} />);
    expect(screen.getByText('Open a document')).toBeInTheDocument();
    expect(screen.getByText(/Drop a PDF/)).toBeInTheDocument();
  });

  it('Open button is disabled when URL is empty', () => {
    render(<EmptyTabView {...defaultProps} urlInput="" />);
    expect(screen.getByText('Open')).toBeDisabled();
  });

  it('Open button is enabled when URL is provided', () => {
    render(<EmptyTabView {...defaultProps} urlInput="https://example.com/doc.pdf" />);
    expect(screen.getByText('Open')).not.toBeDisabled();
  });

  it('calls onUrlInputChange when typing in URL input', () => {
    const onUrlInputChange = vi.fn();
    render(<EmptyTabView {...defaultProps} onUrlInputChange={onUrlInputChange} />);
    fireEvent.change(screen.getByPlaceholderText('Paste PDF URL...'), { target: { value: 'https://test.com' } });
    expect(onUrlInputChange).toHaveBeenCalledWith('https://test.com');
  });

  it('calls onUrlSubmit on form submit', () => {
    const onUrlSubmit = vi.fn((e) => e.preventDefault());
    render(<EmptyTabView {...defaultProps} urlInput="https://example.com" onUrlSubmit={onUrlSubmit} />);
    fireEvent.click(screen.getByText('Open'));
    expect(onUrlSubmit).toHaveBeenCalledOnce();
  });

  it('file input has correct accept attribute', () => {
    render(<EmptyTabView {...defaultProps} />);
    const fileInput = document.getElementById('test-file-id') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.accept).toBe('.pdf');
    expect(fileInput.multiple).toBe(true);
  });
});
