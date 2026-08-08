/**
 * Default Bundled Master Onboarding & Feature Showcase Guide for KogNote.
 * Bundled inside the application binary so every user gets a comprehensive guide
 * and interactive feature showcase automatically when a vault is initialized.
 */

export interface OnboardingNote {
  filename: string;
  content: string;
}

export const ONBOARDING_NOTES: OnboardingNote[] = [
  {
    filename: "Welcome to KogNote - Complete Guide & Feature Showcase.md",
    content: `---
type: guide
status: active
priority: high
tags: [welcome, guide, kognote, features, flashcards, tasks, graph, ai]
created: "2026-08-08T00:00:00"
updated: "2026-08-08T00:00:00"
---

# 🧠 Welcome to KogNote — Master Guide & Feature Showcase

> **KogNote** is your local-first, privacy-focused, cross-platform personal knowledge base & neural thinking assistant. Built for fast note-taking, standard Markdown, offline vector RAG search, interactive 2D graph visualization, FSRS spaced-repetition flashcards, structured task tracking, Excalidraw whiteboards, and local/cloud AI capabilities.

---

## ⚡ 1. Fast Keyboard Shortcuts

Master these essential shortcuts to navigate KogNote with speed:

| Shortcut (macOS / Windows) | Action Description |
| :--- | :--- |
| \`⌘ + N\` / \`Ctrl + N\` | Create New Note |
| \`⌘ + E\` / \`Ctrl + E\` | Toggle Editor Mode (Visual WYSIWYG ↔ Source Markdown) |
| \`⌘ + K\` / \`Ctrl + K\` | Command Palette & Quick File Search |
| \`⌘ + Shift + D\` / \`Ctrl + Shift + D\` | Open / Create Today's Daily Journal Log |
| \`⌘ + \\\` / \`Ctrl + \\\` | Toggle File Tree Sidebar |
| \`⌘ + Shift + C\` / \`Ctrl + Shift + C\` | Toggle AI Copilot Chat Drawer |
| \`⌘ + Shift + I\` / \`Ctrl + Shift + I\` | Open Inline Floating AI Writing Toolbar |
| \`⌘ + 1 .. 7\` / \`Ctrl + 1 .. 7\` | Switch Main Views (Editor, Canvas, Graph, Flashcards, Calendar, Tasks, Board) |

---

## 📝 2. Dual-Engine Editor & Text Formatting

KogNote features a dual-engine editor. Toggle seamlessly between **WYSIWYG Visual Mode** (Milkdown) and **Source Mode** (CodeMirror 6 syntax highlighting).

### Natural Language Date Autoconversion
Type \`@\` followed by natural language anywhere in your note text to convert into structured date tags:
- \`@today\` → \`@2026-08-08\`
- \`@tomorrow\` → \`@2026-08-09\`
- \`@next monday\` → \`@2026-08-10\`

### Rich Callouts & GitHub-Style Alerts
> [!NOTE]
> Local-first architecture ensures 100% of your notes remain private on your device.

> [!TIP]
> Use \`Ctrl + K\` to open the Command Palette from anywhere in the app!

> [!IMPORTANT]
> All WikiLinks, tags, and tasks update in real time across the entire vault.

---

## 🔗 3. WikiLinks, Backlinks & 2D Knowledge Graph

Connect your notes using double brackets to build a personal knowledge web:

- **Standard WikiLink:** Link directly to another note like \`[[Welcome to KogNote - Complete Guide & Feature Showcase]]\`.
- **WikiLink with Custom Display Alias:** Format as \`[[Welcome to KogNote - Complete Guide & Feature Showcase|Read App Master Guide]]\`.

### Interactive 2D Knowledge Graph
Click **Graph View** in the left sidebar (or press \`Ctrl + 3\`).
- **Degree Centrality:** Connected hub notes float toward the center core.
- **Connection Filters:** Toggle Tags \`#tag\`, Folders, Backlinks \`[[link]]\`, URLs \`http://\`, Attachments, and Daily Notes.
- **Semantic AI Controls:** Turn on the Semantic AI toggle in the Graph sidebar to render glowing indigo links between conceptually related notes calculated by local vector embeddings (\`nomic-embed-text-v1.5\`) in under 5ms!

---

## ✅ 4. Task Management, Priorities & Kanban Board

Turn any Markdown bullet into a trackable task using standard checkbox syntax (\`- [ ]\`):

- [ ] High priority project milestone @2026-08-10 !high #work
- [ ] Review documentation and update release notes @2026-08-12 !medium #dev
- [x] Initial KogNote vault setup and configuration @2026-08-08 !low #setup

### Priority Tags
- \`!high\` or \`!!!\` → High Priority (Red Badge)
- \`!medium\` or \`!!\` → Medium Priority (Amber Badge)
- \`!low\` or \`!\` → Low Priority (Blue Badge)

### Unified Views
- **Tasks View (\`Ctrl + 6\`):** Filter, search, and manage all tasks across your entire vault by completion, priority, or due date.
- **Kanban Board (\`Ctrl + 7\`):** Drag and drop task cards across **Backlog**, **Todo**, **In Progress**, **In Review**, and **Done** columns!

---

## 🎴 5. Spaced Repetition Flashcards (FSRS Algorithm)

Create flashcards directly inside any note. KogNote automatically indexes them into the **Flashcards View (\`Ctrl + 4\`)** with the Free Spaced Repetition Scheduler (FSRS) algorithm:

### Flashcard Syntax Examples:

1. **Inline Single-Line Format:**
   What is local RAG vector search? :: A retrieval mechanism querying vector embeddings in SQLite without cloud dependencies.

2. **Q & A Format:**
   Q: Which model powers local vector search in KogNote? / A: nomic-embed-text-v1.5 (768-dimensional Q8 quantized model).

3. **Multi-Line START / END Format:**
   START
   Question: What is FSRS?
   Back: Free Spaced Repetition Scheduler — a modern algorithm for optimizing memory retention.
   END

---

## 🎨 6. Excalidraw Visual Whiteboards (.excalidraw)

Click **Canvas View (\`Ctrl + 2\`)** or create a new \`.excalidraw\` file to sketch flowcharts, architecture diagrams, wireframes, and freehand visual brainstorms alongside your markdown notes.

---

## 🤖 7. AI Copilot, Local RAG Search & System Guidelines

Open the **Copilot Chat Drawer (\`Ctrl + Shift + C\`)** or select text in the editor to use the **Floating AI Toolbar (\`Ctrl + Shift + I\`)**:

- **Local Offline Models:** Connect local Ollama / LM Studio servers (e.g. \`llama3\`, \`mistral\`, \`qwen2.5\`) for 100% offline private AI intelligence.
- **Custom Cloud API Keys:** Connect OpenAI, OpenRouter, Groq, or DeepSeek API keys directly in **Settings**.
- **Local RAG Vector Context:** Copilot queries your SQLite vector database (\`nomic-embed-text-v1.5\`) to answer questions with exact citations from your personal notes.
- **Project Guidelines (\`AGENTS.md\`):** Add an \`AGENTS.md\` file to your vault to customize Copilot's tone, instructions, and coding standards.

---

## 🔒 8. Local-First Storage & Data Ownership

All your notes are standard \`.md\` files saved directly in your chosen vault directory. You can open, sync, back up, or git-version your vault using any tool or text editor. Your data is yours forever.
`,
  },
];
