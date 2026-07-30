// Local Markdown Smart Formatter for Kognote

export function smartFormatLocal(markdown: string): string {
  if (!markdown) return "";

  // 1. Extract and preserve YAML Frontmatter metadata completely untouched
  let frontmatter = "";
  let bodyContent = markdown;

  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    frontmatter = fmMatch[0];
    bodyContent = markdown.substring(frontmatter.length);
  }

  // 2. Protect Fenced Code Blocks (```...```) and Inline Code Spans (`...`)
  const codeBlocks: string[] = [];
  let protectedBody = bodyContent.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `___CODE_BLOCK_${codeBlocks.length - 1}___`;
  });

  const inlineCodes: string[] = [];
  protectedBody = protectedBody.replace(/`[^`\r\n]+`/g, (match) => {
    inlineCodes.push(match);
    return `___INLINE_CODE_${inlineCodes.length - 1}___`;
  });

  // 3. Process Body Line by Line
  const lines = protectedBody.split(/\r?\n/);
  const formattedLines: string[] = [];
  let consecutiveEmptyLines = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimEnd();

    // Collapse excessive blank lines to max 1-2 clean empty lines
    if (line.trim() === "") {
      consecutiveEmptyLines++;
      if (consecutiveEmptyLines <= 1) {
        formattedLines.push("");
      }
      continue;
    }
    consecutiveEmptyLines = 0;

    // A. Format Headings: Ensure space after #
    if (/^#{1,6}[^#\s]/.test(line)) {
      line = line.replace(/^(#{1,6})([^#\s])/, "$1 $2");
    } else if (/^#{1,6}\s{2,}/.test(line)) {
      line = line.replace(/^(#{1,6})\s+/, "$1 ");
    }

    // B. Format Bullet & Checklist Lists
    if (/^\s*[-*+]\s+/.test(line)) {
      const taskMatch = line.match(/^(\s*)[-*+]\s+(?:\[([ xX])\])?\s*(.+)$/);
      if (taskMatch) {
        const indent = taskMatch[1] || "";
        const isChecklist = taskMatch[2] !== undefined;
        const checkStatus = (taskMatch[2] || " ").toLowerCase();
        let taskBody = taskMatch[3];

        if (isChecklist) {
          // Standardize checklist item: '- [ ] task...'
          line = `${indent}- [${checkStatus}] ${taskBody}`;
        } else {
          // Check if bullet line contains task markers (@task, due date, or priority) and convert to checklist
          if (/@task\b|@due:?\s*20\d{2}[-/]\d{2}[-/]\d{2}|(?:\b|\s)!!!(?:\b|\s)/i.test(taskBody)) {
            line = `${indent}- [ ] ${taskBody}`;
          } else {
            // Standard bullet list item
            line = `${indent}- ${taskBody}`;
          }
        }
      }
    }

    // C. Format Numbered Lists: Ensure space after number marker
    const numListMatch = line.match(/^(\s*\d+\.)([^\s].*)$/);
    if (numListMatch) {
      line = `${numListMatch[1]} ${numListMatch[2]}`;
    }

    // D. Standardize Date Mentions: '@due:2026/07/29' or '@2026/07/29' -> '@2026-07-29'
    line = line.replace(/@due:?\s*(20\d{2})[/](0[1-9]|1[0-2])[/](0[1-9]|[12]\d|3[01])/gi, "@$1-$2-$3");

    formattedLines.push(line);
  }

  let resultBody = formattedLines.join("\n");

  // 4. Restore Inline Code Spans
  resultBody = resultBody.replace(/___INLINE_CODE_(\d+)___/g, (_, idx) => inlineCodes[parseInt(idx, 10)] || "");

  // 5. Restore Code Blocks
  resultBody = resultBody.replace(/___CODE_BLOCK_(\d+)___/g, (_, idx) => codeBlocks[parseInt(idx, 10)] || "");

  // 6. Re-attach untouched YAML Frontmatter
  return frontmatter ? `${frontmatter}${resultBody}` : resultBody;
}

/**
 * A fast, offline, rules-based formatter to turn raw voice transcripts into beautiful Markdown.
 * Perfect for mac and windows without waiting for a local AI model to run.
 */
export function smartFormatVoiceTranscript(transcript: string): string {
  if (!transcript) return "";

  // 1. Basic speech cleanup: capitalize sentences and filter out fillers
  let text = transcript.trim();
  
  // Normalize spacing
  text = text.replace(/\s+/g, " ");

  // Remove common verbal fillers
  const fillers = [
    /\b(um|uh|ah|er|eh|like, indeed|you know,)\b/gi,
    /\b(so basically|basically|actually|honestly|sort of|kind of)\b/gi
  ];
  for (const filler of fillers) {
    text = text.replace(filler, "");
  }

  // 2. Identify paragraph splits based on transition markers
  // Split into raw sentences (approximate by finding punctuation or common transition words)
  const transitions = [
    "first of all", "firstly", "secondly", "thirdly",
    "on the other hand", "to start with", "to begin with",
    "in addition", "furthermore", "also", "next", "finally", "in conclusion",
    "that reminds me", "by the way", "speaking of"
  ];

  // Force space before transitions and split
  let processedText = text;
  for (const trans of transitions) {
    const regex = new RegExp(`\\b(${trans})\\b`, "gi");
    processedText = processedText.replace(regex, "\n\n$1");
  }

  // Split into lines/paragraphs
  const blocks = processedText.split(/\n+/);
  const formattedBlocks: string[] = [];

  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;

    // Capitalize first letter
    block = block.charAt(0).toUpperCase() + block.slice(1);

    // Ensure ending punctuation
    if (!/[.!?:]$/.test(block)) {
      block += ".";
    }

    // 3. Bullet list detection
    // Match patterns like: "bullet: ", "point: ", "first: ", "next: ", "second: " at start
    const bulletPattern =/^(bullet|point|list item|first|second|third|next|finally|also)\b\s*[:-]?\s*(.*)/i;
    const bulletMatch = block.match(bulletPattern);
    if (bulletMatch) {
      const content = bulletMatch[2].trim();
      if (content) {
        const capitalizedContent = content.charAt(0).toUpperCase() + content.slice(1);
        formattedBlocks.push(`- **${bulletMatch[1].toUpperCase()}:** ${capitalizedContent}`);
        continue;
      }
    }

    // 4. Heading detection
    // Match "heading 1", "section title", "title"
    const headingPattern =/^(heading|title|section|header)\s*(\d*)\s*[:-]?\s*(.*)/i;
    const headingMatch = block.match(headingPattern);
    if (headingMatch) {
      const level = parseInt(headingMatch[2]) || 2;
      const titleText = headingMatch[3].trim();
      if (titleText) {
        const hash = "#".repeat(Math.min(Math.max(level, 1), 4));
        const capitalizedTitle = titleText.charAt(0).toUpperCase() + titleText.slice(1);
        formattedBlocks.push(`\n${hash} ${capitalizedTitle}\n`);
        continue;
      }
    }

    formattedBlocks.push(block);
  }

  // Create document header
  const today = new Date();
  const dateString = today.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const timeString = today.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit'
  });

  const header = `---
type: voice-note
date: ${today.toISOString().split('T')[0]}
time: ${timeString}
---

# Voice Note: ${dateString}

> [!NOTE]
> Transcribed on ${dateString} at ${timeString} using offline voice dictation.

`;

  return header + formattedBlocks.join("\n\n");
}

