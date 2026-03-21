# PDF Notes

AI-powered PDF reader. Users open PDFs, select text or screenshot regions, and chat with Google Gemini about them.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS 4 (CSS-first config)
- **PDF:** react-pdf / pdfjs-dist
- **AI:** Google Gemini (`gemini-3-flash-preview`) via `@google/genai`
- **Drag & Drop:** @dnd-kit
- **Markdown:** react-markdown + remark-math + rehype-katex

## Architecture

### Client (single-page app, `ssr: false`)

```
app/page.tsx              → ErrorBoundary + dynamic PDFViewer import
app/PDFViewer.tsx          → Main orchestrator (~1400 lines, partially refactored)
app/types.ts               → Shared types (Tab, constants)
app/hooks/useSelection.ts  → Selection + chat history state
app/hooks/useKeyboardShortcuts.ts → Global keyboard shortcuts
app/components/
  AIPopover.tsx            → Chat UI (streaming, retry, export)
  AreaSelector.tsx         → Screenshot capture tool
  ChatPicker.tsx           → "New Chat" picker on selection
  EmptyTabView.tsx         → Upload/URL entry screen
  SelectionHighlights.tsx  → Colored highlight overlays on PDF pages
  TabBar.tsx               → Draggable tab bar with DnD
  ErrorBoundary.tsx        → Catches render errors
```

### Server (API routes only)

```
app/api/ask/route.ts            → Streaming chat (POST, ReadableStream)
app/api/generate-title/route.ts → Auto-title generation (POST)
app/lib/gemini.ts               → Gemini SDK singleton
app/lib/rate-limit.ts           → In-memory IP-based rate limiter
```

### State Management

- All state is client-side (React state + refs). No database.
- Tab state (history, selections, scroll position) saved/restored on tab switch.
- `currentMessagesRef` is a ref (not state) to avoid re-renders during streaming.
- Dark mode: class on `<html>` element, preference in `localStorage('pdfnotes-dark-mode')`.
- Only the active tab's PDF `<Document>` is mounted (others unmounted to save memory).

## Key Patterns

### Selection → Chat Flow

1. User selects text (mouseup) or draws area (AreaSelector) → `pendingSelection`
2. ChatPicker appears → user clicks "New Chat"
3. `pendingSelection` promotes to `currentSelection`, AIPopover opens
4. User types question → streamed to `/api/ask` → response streams back
5. On close/new selection → chat moves to `history[]` or `generatingSelections` Map

### Streaming

AIPopover uses `fetch` + `ReadableStream` reader. The `doSend()` function handles both initial sends and retries. Updates messages on every chunk. AbortController for cancellation.

### Error Handling

- `doSend()` does NOT revert messages on error — user message stays visible with a retry button
- Empty streaming responses trigger an explicit error
- Title generation fetch has AbortController for cleanup on unmount
- `generatingSelections` Map has 5-minute safety timeout for hung streams

## Commands

```bash
npm run dev          # Development server
npm run build        # Production build (validates types)
npm run lint         # ESLint
npm test             # Vitest unit + integration tests
npm run test:watch   # Vitest in watch mode
```

## Environment

`GEMINI_API_KEY` — Required. See `.env.example`.

## Testing

- **Framework:** Vitest + React Testing Library + jsdom
- **Test files:** `__tests__/` directories alongside source files
- **Run before committing:** `npm test`
- Mocks: Gemini SDK, rate limiter, KaTeX CSS, fetch for API tests

## Security

- `next.config.ts` sets X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- Markdown rendering uses `skipHtml` to prevent XSS from AI responses
- Rate limiting: 10 req/min for `/api/ask`, 20 req/min for `/api/generate-title`
- Dark mode FOUC prevention via inline `<script>` in layout.tsx
