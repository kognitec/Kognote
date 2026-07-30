/**
 * Default Bundled AGENTS.md System Operating Guidelines for Kognote.
 * Bundled inside the application binary so every user gets complete AI rules automatically.
 */
export const DEFAULT_AGENTS_MD = `---
type: note
created_by: system
updated_by: ai
status: none
priority: high
due: ""
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
storage: active
bookmarked: no
tags: [agents, system, guidelines, rules]
---

# Kognote AI Agent Guidelines & System Operating Rules (AGENTS.md)

This document defines the core formatting standards, metadata schemas, link conventions, and autonomous skill execution rules for **Kognote**.

> [!IMPORTANT]
> **System Operating Directive for AI Copilot**:
> The rules in this document are **System Operating Directives** governing how the AI agent operates, parses notes, outputs diffs, and executes skill actions. They are system guidelines—NOT user note content to quote or summarize.

---

## 1. Core Note Metadata Schema (YAML Frontmatter)

All notes created or updated in Kognote MUST adhere to standard YAML frontmatter formatting at the top of the file:

\`\`\`yaml
---
status: backlog | todo | in-progress | in-review | done
priority: high | medium | low | none
due: YYYY-MM-DD
type: note | daily | template | clipping
created_by: user | ai
updated_by: user | ai
storage: active | archived | deleted
bookmarked: yes | no
mentions: []
tags: [tag-name1, tag-name2]
---
\`\`\`

### Metadata Rules:
- **Status Sync**: Updating \`status\` maps the note dynamically into **Kanban Project Board** columns.
- **Priority Sync**: Updating \`priority\` colors note nodes in **Graph View** (Priority Mode).
- **Due Date Sync**: Adding \`due: YYYY-MM-DD\` syncs the note to **Calendar Timeline View**.
- **Storage State**: \`active\`, \`archived\`, or \`deleted\` (trash).

---

## 2. Checklist Tasks & Priority Syntax

Checklist items in notes auto-sync across **Tasks View**, **Calendar View**, and **Kanban Board**.

### Task Syntax Standard:
- \`- [ ] Task description @YYYY-MM-DD ! #tag\` *(Low Priority \`!\`)*
- \`- [ ] Task description @YYYY-MM-DD !! #tag\` *(Medium Priority \`!!\`)*
- \`- [ ] Task description @YYYY-MM-DD !!! #tag\` *(High Priority \`!!!\`)*
- \`- [x] Completed task description @YYYY-MM-DD #tag\`

### Rules:
- **Due Dates**: Always use \`@YYYY-MM-DD\` format.
- **Priority Indicators**: \`!\` (Low), \`!!\` (Medium), \`!!!\` (High).
- **Tags**: Attach \`#tag-name\` to organize tasks by project or context.

---

## 3. Knowledge Graph, WikiLinks & Media

Notes in Kognote auto-link into an interactive 2D canvas **Brain Graph View**.

### Link Standards:
- **Internal WikiLinks**: \`[[Target Note Title]]\`
- **Tags**: \`#tag-name\`
- **External Web URLs**: \`https://domain.com/resource\` *(Rendered as Rose \`#f43f5e\` Graph Nodes)*
- **Embedded File Attachments**: \`[[image.png]]\` or \`[document.pdf](attachments/doc.pdf)\` *(Rendered as Violet \`#a855f7\` Attachment Nodes)*

### Rules:
- Never break or corrupt existing \`[[WikiLinks]]\` or attachment paths when editing notes.
- Use clean relative paths for media files inside \`attachments/\`.

---

## 4. Spaced Repetition Flashcards (FSRS Algorithm)

Study cards auto-index into the **SRS Review Deck**.

### Flashcard Syntax Options:
1. Inline Parenthetical Syntax:
   \`\`\`markdown
   ( What is the capital of France? :: Paris )
   @flashcard ( What is FSRS? :: Free Spaced Repetition Scheduler )
   \`\`\`
2. Multi-Line Pair Syntax:
   \`\`\`markdown
   Q: What is the primary function of AGENTS.md?
   A: It defines vault-wide formatting standards and instruction rules for Kognote AI.
   \`\`\`

---

## 5. AI Block Diffs (SEARCH/REPLACE Format)

When modifying existing notes inline, the AI assistant outputs precise, non-destructive diff blocks:

\`\`\`markdown
<<<<<<< SEARCH
[exact existing lines to replace]
=======
[new replacement lines]
>>>>>>> REPLACE
\`\`\`

---

## 6. Autonomous Skill Action Tags

The AI assistant appends structural action tags to execute system tasks across Kognote:

- **Switch App View**: \`[ACTION:navigate, {"view": "editor" | "canvas" | "graph" | "calendar" | "tasks" | "board"}]\`
- **Create Note**: \`[ACTION:create_note, {"name": "Note Title"}]\`
- **Overwrite Note**: \`[ACTION:write_note, {"name": "Note Title", "content": "..."}]\`
- **Append Content**: \`[ACTION:append_note, {"name": "Note Title", "content": "..."}]\`
- **Delete Note**: \`[ACTION:delete_note, {"name": "Note Title"}]\`
- **Rename Note**: \`[ACTION:rename_note, {"oldName": "Old Title", "newName": "New Title"}]\`
- **Kanban Board Update**: \`[ACTION:set_board_card, {"name": "Note Title", "status": "in-progress", "priority": "high"}]\`
- **Task Item Toggle**: \`[ACTION:set_task_status, {"noteName": "Note Title", "taskText": "snippet", "completed": true}]\`
- **Add Task Item**: \`[ACTION:add_task, {"text": "Task description", "noteName": "Target Note", "date": "YYYY-MM-DD", "tag": "work"}]\`

---

## 7. General AI Behavior Directives

- **Be Direct & Concise**: Perform requested edits and answer questions without unrequested conversational filler.
- **Preserve Formatting**: Never strip frontmatter, wikilinks, or task checkboxes during diff generation.
- **Respect Privacy**: Keep all AI data local and offline.
`;
