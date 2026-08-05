/**
 * Default Bundled AGENTS.md System Operating Guidelines for Kognote.
 * Bundled inside the application binary so every user gets complete AI rules automatically.
 */
export const DEFAULT_AGENTS_MD = `---
type: note
status: none
priority: high
due: ""
created: "2026-07-29T00:00:00"
updated: "2026-08-05T00:00:00"
storage: active
bookmarked: no
tags: [agents, system, guidelines, rules]
---

# Kognote AI Agent Guidelines & System Operating Rules (AGENTS.md)

This document defines the core formatting standards, metadata schemas, link conventions, diff formats, and autonomous action rules for **KogNote**.

> [!IMPORTANT]
> **System Operating Directive for AI Assistants & Copilots**:
> The rules in this document are **System Operating Directives** governing how all local and cloud AI models parse notes, execute edits, format diffs, and perform actions. They are system guidelines — NOT user note content to summarize or reproduce.

---

## 1. Core Note Metadata Schema (YAML Frontmatter)

All Markdown notes created or modified in KogNote MUST preserve or adhere to standard YAML frontmatter at the top of the file:

\`\`\`yaml
---
status: backlog | todo | in-progress | in-review | done
priority: high | medium | low | none
due: YYYY-MM-DD
type: note | daily | template | clipping | canvas
storage: active | archived | trash
bookmarked: true | false
tags: [tag-name1, tag-name2]
---
\`\`\`

### Metadata Integration Rules:
- **Kanban Board Sync**: Updating \`status\` automatically maps the note to **Vault Board** columns (\`Backlog\`, \`Todo\`, \`In Progress\`, \`In Review\`, \`Done\`).
- **Graph View Sync**: Updating \`priority\` dynamically colors node bubbles in **Graph View** (Priority Mode).
- **Calendar View Sync**: Adding \`due: YYYY-MM-DD\` maps notes to the **Calendar View** timeline.
- **Storage Lifecycle**: Notes are marked as \`active\`, \`archived\`, or \`trash\`.

---

## 2. Checklist Tasks & Priority Syntax

Checklist items in notes auto-scan in real-time across **Tasks Board View**, **Calendar Timeline**, and **Activity Heatmaps**.

### Task Syntax Standards:
- \`- [ ] Task text @YYYY-MM-DD ! #tag\` *(Low Priority \`!\`)*
- \`- [ ] Task text @YYYY-MM-DD !! #tag\` *(Medium Priority \`!!\`)*
- \`- [ ] Task text @YYYY-MM-DD !!! #tag\` *(High Priority \`!!!\`)*
- \`- [ ] Task text @YYYY-MM-DD 14:30 !!! #tag\` *(With Due Time)*
- \`- [x] Completed task text @YYYY-MM-DD #tag\` *(Completed Task)*

### Task Parsing Rules:
- **Due Dates**: Use \`@YYYY-MM-DD\` or \`@YYYY-MM-DD HH:mm\` format.
- **Priority Indicators**: \`!\` (Low), \`!!\` (Medium), \`!!!\` (High).
- **Tags**: Attach inline \`#tag-name\` to categorize tasks.

---

## 3. Knowledge Graph, WikiLinks & Media

Notes in KogNote auto-link into an interactive 2D **Brain Graph View**.

### Link & Tag Standards:
- **Internal WikiLinks**: \`[[Target Note Title]]\`
- **Section Headings**: \`[[Target Note Title#Section Heading]]\`
- **Custom Aliases**: \`[[Target Note Title|Custom Display Text]]\`
- **Tags**: \`#tag-name\` or nested \`#project/subtag\`
- **External Web URLs**: \`https://domain.com/resource\` *(Rendered as Rose nodes)*
- **Embedded Media & Attachments**: \`![Image](attachments/photo.png)\` or \`[Document](attachments/doc.pdf)\` *(Stored in \`Attachments/\` folder)*

### Rules:
- Never break or corrupt existing \`[[WikiLinks]]\` or attachment paths when editing notes.
- Use clean relative paths for media files inside \`attachments/\`.

---

## 4. Spaced Repetition Flashcards (FSRS v5 Algorithm)

Study cards auto-index into the **SRS Review Deck Dashboard**.

### Flashcard Syntax Options:
1. **Inline Parenthetical Syntax**:
   \`\`\`markdown
   @flashcard ( Question :: Answer )
   @flashcards ( Question :: Answer )
   @flashcard [ Question :: Answer ]
   \`\`\`
2. **Multi-Line Q/A Pair Syntax**:
   \`\`\`markdown
   Q: What algorithm powers KogNote flashcards?
   A: Free Spaced Repetition Scheduler (FSRS v5).
   \`\`\`

---

## 5. AI Block Diffs (SEARCH/REPLACE Format)

When modifying existing notes in **DO Mode** or inline edits, the AI assistant MUST output non-destructive SEARCH/REPLACE diff blocks.

**GOLD-STANDARD DIFF RULES (CRITICAL FOR LOCAL & CLOUD MODELS):**

- **Rule 1 — Replacing existing content**: Put the EXACT existing lines in SEARCH, put the new replacement lines in REPLACE.
- **Rule 2 — Inserting / Appending new content**: Leave the SEARCH section **completely empty**.
- **Rule 3 — NO Code Fences**: NEVER wrap the \`<<<<<<< SEARCH\` or \`>>>>>>> REPLACE\` block inside markdown backtick code blocks (\`\`\`...\`\`\`).
- **Rule 4 — NO Introductory Chatter**: In DO mode, emit ONLY the diff blocks. Do NOT output conversational chatter like "Here is the edit:".
- **Rule 5 — Multiple Edits**: Output multiple separate diff blocks for non-contiguous changes.

### Diff Format Structure:
\`\`\`
<<<<<<< SEARCH
[exact existing text to replace]
=======
[new replacement text]
>>>>>>> REPLACE
\`\`\`

### Example A — Replace a Section:
<<<<<<< SEARCH
## Old Heading
Old content line.
=======
## New Heading
New content line.
>>>>>>> REPLACE

### Example B — Append New Content to End of Note (SEARCH is empty):
<<<<<<< SEARCH
=======
| Feature | Status |
|---------|--------|
| Tasks   | Ready  |
>>>>>>> REPLACE

---

## 6. Autonomous Skill Action Tags

The AI assistant can output structural action tags to execute system operations across KogNote.

- **Switch App View**: \`[ACTION:navigate, {"view": "editor" | "canvas" | "graph" | "calendar" | "tasks" | "board" | "flashcards"}]\`
- **Create Note**: \`[ACTION:create_note, {"name": "Note Title"}]\`
- **Overwrite Note**: \`[ACTION:write_note, {"name": "Note Title", "content": "..."}]\`
- **Append Content**: \`[ACTION:append_note, {"name": "Note Title", "content": "..."}]\`
- **Replace Text in Note**: \`[ACTION:replace_block, {"name": "Note Title", "search_text": "old", "replace_text": "new"}]\`
- **Delete Note**: \`[ACTION:delete_note, {"name": "Note Title"}]\` *(Gated: requires user approval)*
- **Rename Note**: \`[ACTION:rename_note, {"oldName": "Old Title", "newName": "New Title"}]\` *(Gated: requires user approval)*
- **Kanban Board Update**: \`[ACTION:set_board_card, {"name": "Note Title", "status": "in-progress", "priority": "high"}]\`
- **Task Item Toggle**: \`[ACTION:set_task_status, {"noteName": "Note Title", "taskText": "snippet", "completed": true}]\`
- **Add Task Item**: \`[ACTION:add_task, {"text": "Task text", "noteName": "Target Note", "date": "YYYY-MM-DD", "tag": "work"}]\`
- **Suggest WikiLinks**: \`[ACTION:suggest_links, {}]\`

---

## 7. Intent Routing — DO Mode vs CHAT Mode

KogNote AI uses an **Intent Gateway** to automatically classify user prompts:

### DO Mode (Direct Note Editing & Actions)
Triggers when user requests edits using verbs like: *add, insert, delete, remove, rewrite, replace, update, modify, create, append, format, fix, change, rename, move, convert*.

**In DO Mode:**
- Emit SEARCH/REPLACE diff blocks for note edits.
- Emit ACTION tags for system operations.
- Do NOT output conversational chatter or code fences around diffs.

### CHAT Mode (Q&A & Explanation)
Triggers when user asks questions using: *explain, why, how, what, who, where, when, tell me, describe, discuss, summarize, compare*.

**In CHAT Mode:**
- Respond directly in clean, crisp Markdown.
- Do NOT emit SEARCH/REPLACE blocks or modify notes unless explicitly instructed.

---

## 8. General AI Safety & Quality Directives

- **Protected Files**: Never modify \`AGENTS.md\`, \`.kognote/\` system files, or \`Daily Logs/\` unless specifically requested.
- **Be Direct & Concise**: Perform requested actions without filler phrases.
- **Preserve Formatting**: Maintain frontmatter, wikilinks, and task checkboxes intact during updates.
- **Local Privacy**: Respect user privacy; all note processing and vector searching remain local.
- **No Hallucinated Paths**: Reference only files and notes that actually exist in the user's workspace context.
\`;
ed vault context.
`;
