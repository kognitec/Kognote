/**
 * Default Bundled Onboarding & Guide Notes for KogNote.
 * Bundled inside the application binary so every user gets comprehensive guides
 * and interactive sample notes automatically when a vault is initialized.
 */

export interface OnboardingNote {
  filename: string;
  content: string;
}

export const ONBOARDING_NOTES: OnboardingNote[] = [
  {
    filename: "00 - Welcome to KogNote.md",
    content: `---
type: guide
status: active
priority: high
tags: [welcome, guide, overview, kognote]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 🧠 Welcome to KogNote

> **KogNote** is your local-first, privacy-focused, cross-platform personal knowledge base. Designed for fast note-taking, structured task tracking, spaced repetition learning, and AI-assisted thinking.

---

## 🚀 Quick Start Guide

Welcome to your new vault! KogNote comes pre-loaded with comprehensive guides to help you master every section of the app:

1. **[[01 - Guide - Dual-Mode Editor & Formatting]]**: Master the Milkdown WYSIWYG editor, CodeMirror source mode, and Find & Replace shortcuts (\`⌘F\` / \`⌘H\`).
2. **[[02 - Guide - Tasks, Due Dates & Kanban Board]]**: Learn how to write markdown tasks (\`- [ ]\`), set priorities (\`!\`, \`!!\`, \`!!!\`), assign due dates (\`@YYYY-MM-DD\`), and track work on the Kanban board.
3. **[[03 - Guide - Flashcards & Spaced Repetition (FSRS)]]**: Turn any note into flashcards using \`Question :: Answer\` and study with the FSRS spaced repetition engine.
4. **[[04 - Guide - Knowledge Graph & WikiLinks]]**: Connect your notes using \`[[WikiLinks]]\`, discover backlinks, and explore your interactive 2D graph network.
5. **[[05 - Guide - AI Copilot & System Guidelines]]**: Chat with offline local GGUF models (\`llama.cpp\`) or cloud AI, use inline text actions, and understand system rules (\`AGENTS.md\`).

---

## 🎨 Interactive Sample Note

Check out **[[Sample - Complete Feature Showcase]]** to see a live demonstration of tasks, priorities, due dates, flashcards, and WikiLinks in action!

---

## 🔒 Privacy First
All your notes, tasks, flashcards, and settings are stored locally on your device as standard Markdown files. You own your data.
`,
  },
  {
    filename: "01 - Guide - Dual-Mode Editor & Formatting.md",
    content: `---
type: guide
status: active
priority: medium
tags: [guide, editor, formatting, codemirror, milkdown]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 📝 Guide: Dual-Mode Editor & Markdown Formatting

KogNote features a dual-engine editor allowing you to seamlessly switch between **WYSIWYG Visual Mode** and **Source Code Mode**.

---

## 🔄 Switching Editor Modes
- Press **\`⌘ + E\`** (macOS) or **\`Ctrl + E\`** (Windows) to toggle between visual rendering and raw Markdown source editing.
- Or click the **Visual / Source** toggle icon in the top-right header toolbar.

---

## ⚡ Keyboard Shortcuts & Find & Replace

| Action | Shortcut (macOS / Windows) |
| :--- | :--- |
| **Find Text** | \`⌘ + F\` / \`Ctrl + F\` |
| **Replace Text** | \`⌘ + H\` / \`Ctrl + H\` |
| **Export to PDF** | \`⌘ + P\` / \`Ctrl + P\` |
| **Toggle Bold** | \`⌘ + B\` / \`Ctrl + B\` |
| **Toggle Italic** | \`⌘ + I\` / \`Ctrl + I\` |
| **Reveal in Finder** | \`⌘ + Shift + R\` / \`Ctrl + Shift + R\` |

---

## 🛡️ Frontmatter Metadata Protection
KogNote notes start with a YAML frontmatter block enclosed between \`---\` delimiters:

\`\`\`yaml
---
type: note
status: in-progress
priority: high
tags: [guide, markdown]
---
\`\`\`
- Both **Clean Formatting** and **AI Format & Polish** options in the note menu preserve this frontmatter 100% untouched.

---

## 🎨 Rich Markdown Features
- **Callouts**:
  > [!NOTE]
  > Important information or tips.
  
  > [!WARNING]
  > Cautionary notes or alerts.

- **Tables**:
  | Feature | Support |
  | :--- | :--- |
  | WikiLinks | Yes (\`[[Note]]\`) |
  | Code Syntax | Yes (CodeMirror 6) |

- **Math / LaTeX**: Inline \`$E = mc^2$\` or block formulas \`$$\\int f(x) dx$$\`.
`,
  },
  {
    filename: "02 - Guide - Tasks, Due Dates & Kanban Board.md",
    content: `---
type: guide
status: active
priority: medium
tags: [guide, tasks, kanban, productivity]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 📋 Guide: Tasks, Due Dates & Kanban Board

KogNote automatically scans all Markdown tasks (\`- [ ]\`) across your entire vault and aggregates them into unified views.

---

## ✍️ Writing Tasks in Notes

Write standard Markdown checkboxes in any note:

- \`- [ ] Unfinished task @2026-08-01 !!! #work\`
- \`- [x] Completed task @2026-07-28\`

---

## 🎯 Task Syntax Breakdown

| Syntax | Description | Example |
| :--- | :--- | :--- |
| **Checkbox** | Task completion status | \`- [ ]\` (Pending), \`- [x]\` (Done) |
| **Due Date** | \`@YYYY-MM-DD\` or \`@due:YYYY-MM-DD\` | \`- [ ] Submit report @2026-08-15\` |
| **Priority Flags** | \`!\` (Low), \`!!\` (Medium), \`!!!\` (High) | \`- [ ] Fix critical bug !!!\` |
| **Tags** | \`#tagname\` for categorization | \`- [ ] Buy groceries #personal\` |

---

## 📊 Views & Workflows
- **Tasks View (\`📋\` Sidebar)**: Filter tasks by due date (*Overdue*, *Today*, *Upcoming*), priority, or search query.
- **Kanban Board (\`📌\` Sidebar)**: Drag and drop tasks across workflow columns (*To Do*, *In Progress*, *Review*, *Done*).
`,
  },
  {
    filename: "03 - Guide - Flashcards & Spaced Repetition (FSRS).md",
    content: `---
type: guide
status: active
priority: medium
tags: [guide, flashcards, fsrs, learning]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 🃏 Guide: Flashcards & Spaced Repetition (FSRS)

Supercharge your memory retention by creating flashcards inline inside your notes.

---

## ✍️ Creating Flashcards

### 1. Double-Colon \`::\` Delimiter Syntax
Simply separate the question and answer with double colons \`::\`:

\`What is the capital of France? :: Paris\`

\`What algorithm powers KogNote's flashcards? :: Free Spaced Repetition Scheduler (FSRS)\`

### 2. \`#flashcard\` Tag Syntax
Or tag a block or list item with \`#flashcard\`:

\`- What is Markdown? :: A lightweight markup language with plain text formatting syntax. #flashcard\`

---

## 🧠 Reviewing Flashcards (\`🎓\` Sidebar)
1. Open the **Review** tab in the sidebar navigation.
2. Click **Start Review Session** to test yourself on cards due today.
3. Rate your recall performance:
   - 🔴 **Again**: Forgot the answer (Reschedules immediately).
   - 🟠 **Hard**: Recalled with difficulty.
   - 🟢 **Good**: Normal recall effort.
   - 🔵 **Easy**: Instant, perfect recall (Extends review interval).
4. KogNote's **FSRS algorithm** dynamically updates interval multipliers to maximize long-term retention.
`,
  },
  {
    filename: "04 - Guide - Knowledge Graph & WikiLinks.md",
    content: `---
type: guide
status: active
priority: medium
tags: [guide, graph, wikilinks, backlink]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 🕸️ Guide: Knowledge Graph & WikiLinks

Connect your thoughts into an interconnected personal knowledge web.

---

## 🔗 Creating WikiLinks
Link any note to another using double square brackets:

- **Standard Link**: \`[[00 - Welcome to KogNote]]\`
- **Link with Display Alias**: \`[[00 - Welcome to KogNote|Go back to Welcome Page]]\`

---

## 🔍 Backlinks & Mentions
- Open any note to inspect the **Backlinks Panel** at the bottom of the editor.
- **Linked Mentions**: Shows all notes that explicitly link to the current note via \`[[Note]]\`.
- **Unlinked Mentions**: Automatically discovers notes that mention the title of the current note without explicit links.

---

## 🌌 Interactive 2D Graph Canvas (\`🕸️\` Sidebar)
- **Barnes-Hut Physics Simulation**: Renders your notes as interconnected visual nodes.
- **Interactivity**: Click any node to open the note instantly, drag nodes to reposition, or scroll to zoom.
- **Node Filtering**: Color-code and filter nodes by tags or search keywords.
`,
  },
  {
    filename: "05 - Guide - AI Copilot & System Guidelines.md",
    content: `---
type: guide
status: active
priority: medium
tags: [guide, ai, copilot, llama, guidelines]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 🤖 Guide: AI Copilot & System Guidelines

KogNote provides a dual-engine AI assistant capable of working 100% offline or with cloud models.

---

## ⚙️ AI Engine Modes (\`⚙️ Settings → AI Settings\`)
1. **Local Offline Engine**: Runs quantized \`.gguf\` models (Llama 3, Mistral, Qwen) using a bundled \`llama.cpp\` sidecar executable. No internet connection or API keys required!
2. **Cloud API Engine**: Connect your API key for OpenAI (GPT-4o), Anthropic (Claude 3.5), or Google Gemini.

---

## 💬 Detachable Chat Panel (\`💬\` Sidebar)
- Chat with your vault context to ask questions, draft summaries, or brainstorm ideas.
- **Detach Window**: Click the **Detach Chat** button in the chat header to pop the copilot out into a floating desktop window.

---

## ✍️ Floating Quick-Toolbar
Highlight any text inside the editor to trigger the Floating AI Quick-Toolbar:
- **Rewrite**: Improve clarity, tone, and flow.
- **Summarize**: Extract key bullet points.
- **Explain**: Simplify complex concepts.

---

## 📜 System Rules & Guidelines (\`AGENTS.md\`)
KogNote bundles system rules (\`DEFAULT_AGENTS_MD\`) ensuring the AI understands:
- Preserving YAML frontmatter (\`--- ... ---\`) 100% untouched.
- Maintaining task syntax (\`- [ ]\`, \`- [x]\`, \`@YYYY-MM-DD\`, \`!\`/\`!!\`/\`!!!\`).
- Preserving flashcards (\`Question :: Answer\`) and WikiLinks (\`[[Note]]\`).
`,
  },
  {
    filename: "Sample - Complete Feature Showcase.md",
    content: `---
type: project
status: in-progress
priority: high
tags: [sample, demo, showcase, tasks, flashcards]
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
---

# 🚀 Sample Note: Interactive KogNote Showcase

> This is a sample demonstration note showcasing KogNote's tasks, priorities, due dates, flashcards, WikiLinks, and callouts!

---

## 📌 Sample Tasks with Priorities & Due Dates

- [ ] Complete KogNote onboarding walkthrough @2026-08-01 !!! #roadmap
- [ ] Review spaced-repetition flashcards in the review tab @2026-07-30 !! #study
- [ ] Explore the interactive 2D knowledge graph @2026-08-05 ! #feature
- [x] Create first vault and open welcome guide @2026-07-29 #setup

---

## 🃏 Sample Spaced Repetition Flashcards

What is KogNote? :: A local-first, privacy-focused AI personal knowledge base. #flashcard

What delimiter syntax creates an inline flashcard? :: Double colons '::' separating question and answer. #flashcard

What algorithm calculates flashcard review intervals in KogNote? :: Free Spaced Repetition Scheduler (FSRS). #flashcard

---

## 🔗 WikiLink Connections

- Read the main guide: [[00 - Welcome to KogNote]]
- Learn editor shortcuts: [[01 - Guide - Dual-Mode Editor & Formatting|Editor Shortcuts & Tips]]
- Master task management: [[02 - Guide - Tasks, Due Dates & Kanban Board]]

---

## 💡 Callouts & Rich Media Showcase

> [!TIP]
> Press **\`⌘ + E\`** (macOS) or **\`Ctrl + E\`** (Windows) to switch between visual rendering and raw source code mode!

> [!NOTE]
> All tasks in this sample note automatically appear in your **Tasks View (\`📋\`)** and **Kanban Board (\`📌\`)**!
`,
  },
];
