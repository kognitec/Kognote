# 🧠 KogNote — Modern AI-Powered Personal Knowledge Base

> **KogNote** is a local-first, privacy-focused, cross-platform personal knowledge management (PKM) application. Built with **Tauri v2, Rust, React 19, and Vite**, KogNote combines dual-mode Markdown editing, bidirectional WikiLinks, an interactive 2D knowledge graph, task management, spaced-repetition flashcards, and a dual-engine AI Copilot (supporting offline local GGUF models via `llama.cpp` and cloud providers).

---

## 🌟 Key Features

### 📝 1. Dual-Engine Markdown Editor
- **WYSIWYG Mode**: Powered by **Milkdown**, providing a rich visual editing experience with live rendering of headings, tables, blockquotes, callouts, and Mermaid diagrams.
- **Source Code Mode**: Built on **CodeMirror 6** with custom syntax highlighting for WikiLinks (`[[Note]]`), task due dates (`@YYYY-MM-DD`), priorities (`!`, `!!`, `!!!`), tags (`#tag`), and flashcard double-colon blocks (`Question :: Answer`).
- **YAML Frontmatter Preservation**: Automatic metadata synchronization (`type`, `tags`, `status`, `created`, `updated`) with zero data-loss formatting.
- **Find & Replace**: Integrated global keyboard shortcuts (`⌘F` / `Ctrl+F` and `⌘H` / `Ctrl+H`) with real-time match cycling and batch replacement.

### 🕸️ 2. Interactive Knowledge Graph
- **High-Performance Canvas 2D Engine**: Custom Barnes-Hut physics simulation rendering thousands of nodes seamlessly.
- **Bidirectional WikiLinks**: Inter-note linking using `[[Note Name]]` or `[[Note Name|Alias]]` with live backlink discovery and unlinked mentions.
- **Node Filtering & Clustering**: Filter graph nodes by tags, storage state (Active vs. Archived), or search queries.

### 🤖 3. Dual-Engine AI Copilot & System Guidelines
- **Local Offline Engine**: Runs quantized GGUF models directly on your hardware via a bundled `llama.cpp` sidecar executable without sending data external.
- **Cloud API Engine**: Native support for OpenAI (GPT-4o), Anthropic (Claude 3.5), and Google Gemini models.
- **System Operating Rules (`AGENTS.md`)**: Bundled system rules (`DEFAULT_AGENTS_MD`) ensuring the AI understands app actions, note mutation boundaries, frontmatter protection, and date structures.
- **Floating AI Quick-Toolbar**: Highlight text to rewrite, summarize, simplify, or explain concepts inline.

### 📋 4. Task Management & Kanban Board
- **Markdown Task Scanner**: Automatically parses task syntax (`- [ ]`, `- [x]`) across all vault notes.
- **Priority & Due Date Tracking**: Supports priority flags (`!`, `!!`, `!!!`), due date mentions (`@YYYY-MM-DD`), and tag filters.
- **Kanban Board**: Drag-and-drop tasks across custom workflow columns (To Do, In Progress, Review, Done).

### 🃏 5. Spaced-Repetition Flashcards (FSRS Engine)
- **Inline Card Creation**: Write flashcards directly inside any note using `Question :: Answer` or `#flashcard` tags.
- **Free Spaced Repetition Scheduler**: Integrated FSRS memory retention algorithm calculating optimal review intervals based on user feedback (*Again*, *Hard*, *Good*, *Easy*).
- **Interactive Review Dashboard**: Statistics on due cards, daily review streaks, and performance analytics.

### 📅 6. Calendar & Timeline Integration
- **iCal Sync & Event Tracking**: Parse dates and scheduled events directly from note frontmatter and inline `@YYYY-MM-DD` mentions.
- **Interactive Month & Week Views**: Track deadlines, daily journals, and scheduled tasks on a visual timeline.

### ⚡ 7. Lightning-Fast Search & File Management
- **Full-Text SQLite FTS5 Search**: Instant search indexing note titles, content, tags, and YAML metadata.
- **24-Hour Auto-Purge Trash Lifecycle**: Built-in background cleanup process (`purge_expired_trash`) for deleted notes.
- **Customizable Titlebar & Window Controls**: Frameless glassmorphic UI supporting custom mac and windows window controls with detachable AI chat side-panels.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [Tauri v2](https://v2.tauri.app/) (Rust + Webview) |
| **Frontend UI** | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [TailwindCSS v4](https://tailwindcss.com/) |
| **Build Tool** | [Vite 7](https://vitejs.dev/) |
| **WYSIWYG Editor** | [Milkdown Crepe](https://milkdown.dev/) |
| **Source Editor** | [CodeMirror 6](https://codemirror.net/) |
| **Database & Indexing** | SQLite FTS5 via `tauri-plugin-sql` / `rusqlite` |
| **Local LLM Engine** | `llama.cpp` sidecar executable |
| **Iconography** | [Lucide React](https://lucide.dev/) |

---

## 📁 Project Architecture & Structure

```text
Notes App/
├── src-tauri/               # Rust Backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs          # Application Entrypoint
│   │   ├── lib.rs           # Tauri Command Handlers & Plugin Setup
│   │   ├── commands.rs      # File I/O, Note Merging & Trash Purge
│   │   ├── watcher.rs       # Real-Time File System Event Watcher
│   │   ├── parser.rs        # Fast Markdown & Frontmatter Parser
│   │   ├── db.rs            # SQLite FTS5 Database Management
│   │   └── llm.rs           # Llama-server Sidecar Controller
│   ├── Cargo.toml           # Rust Dependencies
│   └── tauri.conf.json      # Tauri Application Configuration
├── src/                     # React Frontend
│   ├── components/          # UI Components
│   │   ├── Editor.tsx       # Core Dual-Mode Editor & Note Options
│   │   ├── CopilotChat.tsx  # Detachable AI Copilot Chat Panel
│   │   ├── GraphView.tsx    # Interactive 2D Knowledge Graph
│   │   ├── BoardView.tsx    # Kanban Task Board
│   │   ├── TasksView.tsx    # Comprehensive Task List
│   │   ├── CalendarView.tsx # iCal Sync & Calendar Timeline
│   │   ├── FlashcardReview.tsx # FSRS Spaced-Repetition Engine
│   │   └── FileTree.tsx     # File Tree & Navigation Sidebar
│   ├── contexts/            # React Context Providers (Vault, Settings, Sync)
│   ├── constants/           # Bundled AGENTS.md Operating System Rules
│   └── lib/                 # Utilities (Formatting, Search, Parsing)
└── package.json             # Frontend Dependencies & Scripts
```

---

## ⌨️ Keyboard Shortcuts Reference

| Shortcut (macOS / Windows) | Action |
| :--- | :--- |
| `⌘ + F` / `Ctrl + F` | Open Find & Replace Bar (Find input focused) |
| `⌘ + H` / `Ctrl + H` | Open Find & Replace Bar (Replace input focused) |
| `⌘ + P` / `Ctrl + P` | Export active note to PDF / Print |
| `⌘ + B` / `Ctrl + B` | Toggle Markdown Bold formatting |
| `⌘ + I` / `Ctrl + I` | Toggle Markdown Italic formatting |
| `⌘ + E` / `Ctrl + E` | Toggle Editor Mode (WYSIWYG ↔ Source) |
| `⌘ + Shift + R` / `Ctrl + Shift + R` | Reveal active note in Native File Explorer / Finder |
| `Escape` | Close Find & Replace bar or open dialogs |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [Rust](https://www.rust-lang.org/) (Latest stable toolchain)

### Installation & Local Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/kognitec/Kognote.git
   cd Kognote
   ```

2. **Install Frontend Dependencies**:
   ```bash
   npm install
   ```

3. **Run in Development Mode**:
   ```bash
   npm run tauri dev
   ```

4. **Verify Type-Checking & Builds**:
   ```bash
   # Check Rust backend
   cargo check --manifest-path src-tauri/Cargo.toml

   # Check Frontend compilation
   npm run build
   ```

---

## 📄 License & Author

- **Author**: Jeevan ([`contact@kognitec.com`](mailto:contact@kognitec.com))
- **Organization**: [Kognitec](https://github.com/kognitec)
