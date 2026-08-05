# 🧠 KogNote — Modern AI-Powered Personal Knowledge Base

[![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-blue.svg?logo=tauri)](https://v2.tauri.app/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb.svg?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178c6.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange.svg?logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **KogNote** is a local-first, privacy-focused, cross-platform personal knowledge management (PKM) application. Built with **Tauri v2, Rust, React 19, and Vite**, KogNote seamlessly unifies dual-mode Markdown editing, bidirectional WikiLinks, an interactive 2D knowledge graph, task management, spaced-repetition flashcards, web clippings, and a dual-engine AI Copilot with RAG vector search (supporting offline local GGUF models via `llama.cpp` and cloud providers).

---

## 🌟 Key Features

### 📝 1. Dual-Engine Markdown Editor
- **WYSIWYG Visual Mode**: Powered by **Milkdown Crepe**, providing live visual rendering of headings, tables, blockquotes, callouts, and Mermaid diagrams.
- **Source Code Mode**: Built on **CodeMirror 6** with custom syntax highlighting for WikiLinks (`[[Note]]`), task due dates (`@YYYY-MM-DD`), priorities (`!`, `!!`, `!!!`), tags (`#tag`), and flashcard blocks.
- **Natural Language Date Autoconversion**: Type `@today`, `@tomorrow`, `@next monday`, or `@friday 3pm` to automatically convert text to structured `@YYYY-MM-DD HH:mm` timestamp tags.
- **YAML Frontmatter Preservation**: Automatic metadata synchronization (`type`, `tags`, `status`, `created`, `updated`) with zero data-loss formatting.
- **Find & Replace**: Integrated global keyboard shortcuts (`⌘F` / `Ctrl+F` and `⌘H` / `Ctrl+H`) with real-time match cycling and batch replacement.

### 🕸️ 2. Interactive Knowledge Graph & Ecosystem Links
- **High-Performance Canvas 2D Engine**: Custom Barnes-Hut physics simulation rendering thousands of note nodes seamlessly.
- **Bidirectional WikiLinks**: Inter-note linking using `[[Note Name]]` or `[[Note Name|Alias]]` with live backlink discovery and unlinked mentions.
- **Node Filtering & Clustering**: Filter graph nodes by tags, storage state (Active vs. Archived), bookmarks, or search queries.

### 🤖 3. Dual-Engine AI Copilot & RAG Vector Search
- **Local Offline Engine**: Runs quantized GGUF models directly on your hardware via a bundled `llama.cpp` sidecar executable without sending data externally.
- **SQLite Vector RAG Engine**: Integrated `sqlite-vec` vector similarity search engine indexing your notes for context-aware Q&A.
- **Cloud API Engine**: Native support for OpenAI (GPT-4o), Anthropic (Claude 3.5), and Google Gemini models.
- **System Operating Rules (`AGENTS.md`)**: Bundled system rules (`DEFAULT_AGENTS_MD`) ensuring the AI respects note mutation boundaries, frontmatter protection, and date structures.
- **Floating AI Quick-Toolbar**: Highlight text to rewrite, summarize, simplify, or explain concepts inline.

### 📋 4. Task Management & Kanban Board
- **Markdown Task Scanner**: Automatically parses task syntax (`- [ ]`, `- [x]`) across all vault notes.
- **Priority & Due Date Tracking**: Supports priority flags (`!`, `!!`, `!!!`), due date mentions (`@YYYY-MM-DD [HH:mm]`), and tag filters.
- **Kanban Board**: Drag-and-drop tasks across custom workflow columns (To Do, In Progress, Review, Done).

### 🃏 5. Spaced-Repetition Flashcards (FSRS Engine)
- **Flexible Flashcard Syntaxes**: Create cards inside any note using either `@flashcard ( Question :: Answer )` or `Q: Question / A: Answer` format.
- **Free Spaced Repetition Scheduler**: Integrated FSRS memory retention algorithm calculating optimal review intervals based on user feedback (*Again*, *Hard*, *Good*, *Easy*).
- **Interactive Review Dashboard**: Statistics on due cards, daily review streaks, and performance analytics.

### 📁 6. Advanced Sidebar & Vault Storage Breakdown
- **Compact File Tree**: Space-efficient virtualized file tree navigation with smooth folder expansion and drag-and-drop organization.
- **Header Type Filter Dropdown**: Quickly filter file tree views by **All Files**, **Notes Only (.md)**, **Canvas Drawings (.excalidraw)**, **Templates**, and **Clippings**.
- **Vault Storage Breakdown**: Real-time breakdown metrics for Notes, Canvas, Bookmarks, Clippings, Archived, and Trash counts.
- **Hover Tooltips**: Hover over the `VAULT NOTES` title to view your absolute vault directory location.

### 🪟 7. Custom Window Controls & Cross-Platform Menus
- **Custom Native Controls**: Custom glassmorphic titlebar with platform-aware window controls:
  - **macOS**: Native Traffic Lights (🔴 Close `⌘W`, 🟡 Minimize `⌘M`, 🟢 Fullscreen / <kbd>Option</kbd>+Click Zoom).
  - **Windows / Linux**: Standard Minimize, Maximize, Close buttons with support for Windows 11 Snap Layouts (<kbd>Win</kbd> + <kbd>Z</kbd>).
- **Interactive Menu Dropdowns**: Fully functional `File`, `Edit`, `View`, and `Help` dropdown menus with target tab navigation.

---

## ⌨️ Master Keyboard Shortcuts Reference

| Shortcut (macOS / Windows) | Action |
| :--- | :--- |
| `⌘ + N` / `Ctrl + N` | Create New Note |
| `⌘ + Shift + D` / `Ctrl + Shift + D` | Create / Open Today's Daily Note |
| `⌘ + O` / `Ctrl + O` | Open / Switch Vault Directory |
| `⌘ + S` / `Ctrl + S` | Save Active Note |
| `⌘ + W` / `Ctrl + W` | Close Active Note |
| `⌘ + Shift + R` / `Ctrl + Shift + R` | Reveal Active Note in Finder / File Explorer |
| `⌘ + K` / `Ctrl + K` | Open Command Palette & Global Search |
| `⌘ + \` / `Ctrl + \` | Toggle File Tree Sidebar |
| `⌘ + ,` / `Ctrl + ,` | Open Settings Dialog |
| `⌘ + Shift + C` / `Ctrl + Shift + C` | Toggle Detachable AI Copilot Chat |
| `⌘ + 1` / `Ctrl + 1` | Switch to Editor View |
| `⌘ + 2` / `Ctrl + 2` | Switch to Canvas View |
| `⌘ + 3` / `Ctrl + 3` | Switch to Knowledge Graph View |
| `⌘ + 4` / `Ctrl + 4` | Switch to Flashcards Dashboard |
| `⌘ + 5` / `Ctrl + 5` | Switch to Calendar View |
| `⌘ + 6` / `Ctrl + 6` | Switch to Tasks View |
| `⌘ + 7` / `Ctrl + 7` | Switch to Kanban Board View |
| `⌘ + F` / `Ctrl + F` | Open Find & Replace Bar (Find input) |
| `⌘ + H` / `Ctrl + H` | Open Find & Replace Bar (Replace input) |
| `⌘ + P` / `Ctrl + P` | Export Note to PDF / Print |
| `Win + Z` *(Windows 11)* | Open System Snap Layouts Overlay |

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Framework** | [Tauri v2](https://v2.tauri.app/) (Rust + Webview) |
| **Frontend UI** | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [TailwindCSS v4](https://tailwindcss.com/) |
| **Build Tool** | [Vite 7](https://vitejs.dev/) |
| **WYSIWYG Editor** | [Milkdown Crepe](https://milkdown.dev/) |
| **Source Editor** | [CodeMirror 6](https://codemirror.net/) |
| **Database & Vectors** | SQLite FTS5 + `sqlite-vec` via `tauri-plugin-sql` / `rusqlite` |
| **Local LLM Engine** | `llama.cpp` sidecar executable |
| **Iconography** | [Lucide React](https://lucide.dev/) |

---

## 📁 Project Architecture & Structure

```text
Kognote/
├── src-tauri/               # Rust Backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs          # Application Entrypoint
│   │   ├── lib.rs           # Tauri Command Handlers & Plugin Setup
│   │   ├── commands.rs      # File I/O, Note Merging & Trash Purge
│   │   ├── watcher.rs       # Real-Time File System Event Watcher
│   │   ├── parser.rs        # Fast Markdown & Frontmatter Parser
│   │   ├── db.rs            # SQLite FTS5 & Vector Database
│   │   └── llm.rs           # Llama-server Sidecar Controller
│   ├── Cargo.toml           # Rust Dependencies
│   └── tauri.conf.json      # Tauri Application Configuration
├── src/                     # React Frontend
│   ├── components/          # UI Components
│   │   ├── Editor.tsx       # Core Dual-Mode Editor & Note Header
│   │   ├── Titlebar.tsx     # Custom Glassmorphic Titlebar & Dropdowns
│   │   ├── CopilotChat.tsx  # Detachable AI Copilot Chat Panel
│   │   ├── GraphView.tsx    # Interactive 2D Knowledge Graph
│   │   ├── BoardView.tsx    # Kanban Task Board
│   │   ├── TasksView.tsx    # Comprehensive Task List
│   │   ├── CalendarView.tsx # iCal Sync & Calendar Timeline
│   │   ├── FlashcardReview.tsx # FSRS Spaced-Repetition Engine
│   │   ├── Settings.tsx     # Settings Dialog & Documentation
│   │   └── FileTree.tsx     # File Tree & Vault Breakdown Sidebar
│   ├── contexts/            # React Context Providers (Vault, Settings, Sync)
│   ├── constants/           # Operating System Rules (AGENTS.md)
│   └── lib/                 # Utilities (Search, Keyboard, Vector Indexing)
└── package.json             # Frontend Dependencies & Scripts
```

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

   # Check Frontend compilation & TypeScript
   npx tsc --noEmit
   npm run build
   ```

---

## 📄 License & Author

- **Author**: Jeevan ([`contact@kognitec.com`](mailto:contact@kognitec.com))
- **Organization**: [Kognitec](https://github.com/kognitec)
- **Website**: [https://kognitec.com/](https://kognitec.com/)
