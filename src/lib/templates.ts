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
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
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
- [ ] Action Item 1 @due:+2d !!! #work
- [ ] Action Item 2 @due:+5d !! #followup
- [ ] Action Item 3 @due:+1w ! #review
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
created: "2026-07-29T00:00:00"
updated: "2026-07-29T00:00:00"
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
1. [ ] Top Priority 1 @due:+3d !!! #priority
2. [ ] Top Priority 2 @due:+5d !! #priority
3. [ ] Top Priority 3 @due:+7d ! #priority

---

## 🃏 Spaced Repetition Study Check
- [ ] Run flashcards review session in Review tab (\`🎓\`)
`,
  },
];

/** Deprecated legacy templates that should be automatically purged from existing vaults */
export const LEGACY_DEPRECATED_TEMPLATES = [
  "Bug Report & Troubleshooting.md",
  "Daily Reflection & Journal.md",
  "Project Specification.md",
];
