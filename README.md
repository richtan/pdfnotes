# PDF Notes

AI-powered PDF reader that lets you select text or screenshot regions and ask questions about them. Built with Next.js, Gemini, and react-pdf.

## Features

- **Text & area selection** -- highlight text or screenshot any region of a PDF, then ask AI about it
- **Streaming chat** -- responses stream in real-time with full Markdown and LaTeX math rendering
- **Multi-turn conversations** -- follow-up questions with full context preserved
- **Multiple selections per chat** -- attach several selections to a single conversation
- **Tabs** -- open multiple PDFs side by side, drag to reorder, state persists per tab
- **Drag & drop** -- drop PDF files directly into the app, or paste a URL
- **Dark mode** -- toggle between light and dark themes
- **Zoom** -- 50%--200% with 10% increments

## Getting Started

### Prerequisites

- Node.js 20+
- A [Google AI Studio](https://aistudio.google.com/apikey) API key

### Setup

```bash
git clone <repo-url>
cd pdfnotes
npm install
```

Create a `.env` file:

```
GEMINI_API_KEY=your-api-key-here
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

1. Upload a PDF (file picker, drag & drop, or URL)
2. Select text or use the screenshot tool to capture a region
3. Click **New Chat** to start a conversation about your selection
4. Ask follow-up questions or add more selections to the same chat

Chats appear in a sidebar anchored to the location of the selection on the page. Each chat is minimizable and persists across tab switches.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| PDF | react-pdf / pdfjs-dist |
| AI | Google Gemini (`gemini-3-flash-preview`) via `@google/genai` |
| Markdown | react-markdown, remark-math, rehype-katex |
| Drag & drop | @dnd-kit |

## Project Structure

```
app/
├── api/
│   ├── ask/route.ts              # Streaming chat endpoint
│   └── generate-title/route.ts   # Auto-generates chat titles
├── components/
│   ├── AIPopover.tsx             # Chat UI (messages, input, streaming)
│   ├── AreaSelector.tsx          # Screenshot selection tool
│   ├── ChatPicker.tsx            # "New Chat" picker on selection
│   └── SelectionLayer.tsx        # Text selection overlay
├── hooks/
│   └── useSelection.ts          # Selection & chat history state
├── lib/
│   └── gemini.ts                # Gemini client & model config
├── PDFViewer.tsx                 # Main viewer (tabs, pages, sidebar)
├── page.tsx                      # App entry point
├── layout.tsx                    # Root layout
└── globals.css                   # Global styles
```

## License

MIT
