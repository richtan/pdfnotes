'use client';

interface EmptyTabViewProps {
  fileId: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  urlInput: string;
  onUrlInputChange: (value: string) => void;
  onUrlSubmit: (e: React.FormEvent) => void;
}

export function EmptyTabView({
  fileId,
  onFileChange,
  urlInput,
  onUrlInputChange,
  onUrlSubmit,
}: EmptyTabViewProps) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 mb-6 text-muted-foreground/30">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h2 className="text-lg font-medium text-foreground mb-1">
        Open a document
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        Drop a PDF, upload a file, or paste a URL to start asking AI-powered questions
      </p>
      <div className="flex flex-col items-center gap-4 w-full max-w-sm">
        <label
          htmlFor={fileId}
          className="cursor-pointer h-10 px-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors inline-flex items-center"
        >
          Upload PDF
        </label>
        <input
          id={fileId}
          onChange={onFileChange}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
        />
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <form onSubmit={onUrlSubmit} className="flex items-center gap-2 w-full">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => onUrlInputChange(e.target.value)}
            placeholder="Paste PDF URL..."
            className="flex-1 h-10 px-3 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!urlInput.trim()}
            className="h-10 px-4 bg-secondary hover:bg-secondary/80 disabled:opacity-40 text-secondary-foreground rounded-md text-sm font-medium transition-colors"
          >
            Open
          </button>
        </form>
      </div>
    </div>
  );
}
