/**
 * Official Bundled Note Templates for KogNote
 */

export interface NoteTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  iconName: string;
  content: string;
}

export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    type: "meeting-notes",
    description: "Structure meeting agenda, discussion points, decisions, and action items.",
    iconName: "Users",
    content: `---
type: template
template_type: meeting-notes
tags: [template, meeting, notes, action-items]
created: "2026-08-05T00:00:00"
updated: "2026-08-05T00:00:00"
---

# 🤝 Meeting Notes: [Meeting Title / Topic]

> **Date**: @today  
> **Attendees**: @person1, @person2  
> **Location / Link**: Google Meet / Zoom  

---

## 🎯 Agenda & Key Objectives
- [ ] Goal 1: Discuss project milestones
- [ ] Goal 2: Address technical blockers and timeline
- [ ] Goal 3: Align on upcoming action items

---

## 📝 Key Discussion Points
- **Topic 1**: Summary of main points discussed...
- **Topic 2**: Key feedback, insights, or architecture decisions...

---

## ⚡ Action Items & Next Steps
- [ ] Action Item 1 @2026-08-07 !!! #work
- [ ] Action Item 2 @2026-08-10 !! #followup
- [ ] Action Item 3 @2026-08-12 ! #review
`,
  },
  {
    id: "weekly-review",
    name: "Weekly Review",
    type: "weekly-review",
    description: "Audit weekly progress, celebrate wins, address blockers, and plan top priorities.",
    iconName: "Calendar",
    content: `---
type: template
template_type: weekly-review
tags: [template, weekly-review, reflection, productivity]
created: "2026-08-05T00:00:00"
updated: "2026-08-05T00:00:00"
---

# 🗓️ Weekly Review & Planning: Week [WW]

> **Review Date**: @today  
> **Focus Goal**: Primary objective for the week  

---

## 🎉 Wins & Major Accomplishments
- **Win 1**: Key milestone delivered or problem solved
- **Win 2**: Breakthrough or progress made

---

## 📊 Project & Task Audit
- **Completed Work**: Review completed tasks in Tasks view (\`📋\`)
- **Key Learnings**: Insights, habits, or technical takeaways from this week
- **Obstacles / Bottlenecks**: Challenges faced and solutions for next week

---

## 🚀 Next Week's Top 3 Strategic Priorities
1. [ ] Top Priority 1 @2026-08-08 !!! #priority
2. [ ] Top Priority 2 @2026-08-10 !! #priority
3. [ ] Top Priority 3 @2026-08-12 ! #priority

---

## 🃏 Spaced Repetition Study Check
- [ ] Run flashcards review session in Flashcards tab (\`🎓\`)
`,
  },
  {
    id: "project-brief",
    name: "Project Brief & PRD",
    type: "project-brief",
    description: "Define software, research, or product specifications, goals, timeline, and deliverables.",
    iconName: "FileText",
    content: `---
type: template
template_type: project-brief
tags: [template, project, prd, specification]
created: "2026-08-05T00:00:00"
updated: "2026-08-05T00:00:00"
---

# 🚀 Project Brief: [Project Name]

> **Status**: Planning / In-Progress  
> **Owner**: @author  
> **Target Date**: @2026-09-01  

---

## 📌 Executive Summary
Brief high-level overview of the project, problem statement, and proposed solution.

---

## 🎯 Key Requirements & User Stories
- [ ] User Story 1: As a user, I want to... @2026-08-15 !!! #feature
- [ ] User Story 2: As an admin, I can configure... @2026-08-20 !! #feature

---

## 🏗️ Architecture & Technical Stack
- **Frontend**: React 19, TypeScript, TailwindCSS
- **Backend**: Tauri v2, Rust, SQLite

---

## 🏁 Milestones & Deliverables
- [ ] Milestone 1: Core prototype & backend setup @2026-08-12
- [ ] Milestone 2: User interface & integration @2026-08-22
- [ ] Milestone 3: QA testing & release build @2026-08-30
`,
  },
  {
    id: "web-clipping-summary",
    name: "Web Clipping Summary",
    type: "clipping",
    description: "Template for saving articles, documentation, or research notes from web clippings.",
    iconName: "Globe",
    content: `---
type: clipping
status: active
tags: [clipping, research, article]
created: "2026-08-05T00:00:00"
updated: "2026-08-05T00:00:00"
---

# 🌐 Web Clipping: [Article Title]

> **Source URL**: https://example.com/article  
> **Clipped Date**: @today  
> **Author / Site**: Author Name  

---

## 💡 Key Takeaways & Summary
- **Main Point 1**: Core insight or finding from the article...
- **Main Point 2**: Supporting evidence or argument...

---

## 📝 Excerpt & Clipped Content
> Insert clipped text or reference notes here...

---

## 🏷️ Related Notes & Links
- See related topic: [[00 - Welcome to KogNote]]
`,
  },
];

/** Deprecated legacy templates that should be automatically purged from existing vaults */
export const LEGACY_DEPRECATED_TEMPLATES = [
  "Bug Report & Troubleshooting.md",
  "Daily Reflection & Journal.md",
  "Project Specification.md",
];
