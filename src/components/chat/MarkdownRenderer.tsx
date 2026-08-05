import React, { useState } from "react";
import { Check, Copy, Code2, CheckCircle, ExternalLink } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  onCopyCode?: (code: string) => void;
  openNoteByName?: (name: string) => void;
}

/** Cleanly strips residual raw system action tags, search/replace diff markers, and outer ```markdown wrapping */
function sanitizeRawTokens(raw: string): string {
  if (!raw) return "";
  let clean = raw
    .replace(/\[ACTION:[^\]]*\]/gi, "")
    .replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/gi, "")
    .trim();

  // Strip outer ```markdown ... ``` or ```md ... ``` or ```text ... ``` fences if model wrapped response in code blocks
  const outerFenceRegex = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i;
  if (outerFenceRegex.test(clean)) {
    clean = clean.replace(outerFenceRegex, "$1").trim();
  }

  return clean;
}

/** Parses inline markdown syntax: bold, italic, inline code, wikilinks [[Note]], links [Text](url), strikethrough */
function parseInline(
  text: string,
  openNoteByName?: (name: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  
  // Combined inline regex scanner
  // Match groups: 1=WikiLinkTarget, 2=WikiLinkAlias, 3=ExternalLinkText, 4=ExternalLinkUrl, 5=Bold1, 6=Bold2, 7=Italic1, 8=Italic2, 9=Code, 10=Strike
  const inlineRegex = /(?:\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(?:\[([^\]]+)\]\(([^)]+)\))|(?:\*\*([^*]+)\*\*|__([^_]+)__|(?:\*([^*]+)\*|_([^_]+)_))|(?:`([^`]+)`)|(?:~~([^~]+)~~)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      nodes.push(text.substring(lastIndex, match.index));
    }

    const [
      fullMatch,
      wikiTarget,
      wikiAlias,
      linkText,
      linkUrl,
      boldText1,
      boldText2,
      italicText1,
      italicText2,
      codeText,
      strikeText,
    ] = match;

    if (wikiTarget) {
      const target = wikiTarget.trim();
      const label = wikiAlias ? wikiAlias.trim() : target;
      nodes.push(
        <button
          key={`wiki-${match.index}`}
          type="button"
          onClick={() => openNoteByName?.(target)}
          className="inline-flex items-center gap-1 font-semibold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer my-0.5"
          title={`Open note "${target}"`}
        >
          <span>[[{label}]]</span>
        </button>
      );
    } else if (linkText && linkUrl) {
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
        >
          <span>{linkText}</span>
          <ExternalLink className="h-2.5 w-2.5 inline" />
        </a>
      );
    } else if (boldText1 || boldText2) {
      nodes.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-slate-900 dark:text-slate-100">
          {boldText1 || boldText2}
        </strong>
      );
    } else if (italicText1 || italicText2) {
      nodes.push(
        <em key={`italic-${match.index}`} className="italic text-slate-700 dark:text-slate-300">
          {italicText1 || italicText2}
        </em>
      );
    } else if (codeText) {
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="font-mono text-[11px] text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-500/20 px-1 py-0.5 rounded select-text"
        >
          {codeText}
        </code>
      );
    } else if (strikeText) {
      nodes.push(
        <del key={`strike-${match.index}`} className="line-through text-slate-400 dark:text-slate-500">
          {strikeText}
        </del>
      );
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Push remaining plain text
  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/** Individual Code Block component with Copy button & language label */
const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = (language || "code").toUpperCase();

  return (
    <div className="my-2 rounded-xl bg-slate-900 dark:bg-[#090a12] border border-slate-700 dark:border-white/8 overflow-hidden font-mono text-[11px] shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 dark:bg-[#0e101a] border-b border-slate-800 dark:border-white/6 text-[10px] font-semibold text-slate-400">
        <div className="flex items-center gap-1.5 text-indigo-400 font-mono tracking-wider text-[10px]">
          <Code2 className="h-3 w-3" />
          <span>{displayLang}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer text-[10px]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-slate-100 dark:text-slate-200 overflow-x-auto whitespace-pre leading-relaxed select-text font-mono custom-scrollbar">
        {code}
      </pre>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  openNoteByName,
}) => {
  const cleanContent = sanitizeRawTokens(content);
  if (!cleanContent) return null;

  const lines = cleanContent.split("\n");
  const blocks: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeLanguage = "";
  let codeBuffer: string[] = [];

  let currentList: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;

  const flushList = () => {
    if (currentList) {
      if (currentList.type === "ul") {
        blocks.push(
          <ul key={`ul-${blocks.length}`} className="list-disc list-inside space-y-1 my-1.5 text-slate-700 dark:text-slate-300 text-xs pl-1">
            {currentList.items}
          </ul>
        );
      } else {
        blocks.push(
          <ol key={`ol-${blocks.length}`} className="list-decimal list-inside space-y-1 my-1.5 text-slate-700 dark:text-slate-300 text-xs pl-1">
            {currentList.items}
          </ol>
        );
      }
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code Block Toggle
    if (trimmed.startsWith("```")) {
      flushList();
      if (inCodeBlock) {
        inCodeBlock = false;
        const codeText = codeBuffer.join("\n");
        const langLower = codeLanguage.toLowerCase();

        if (langLower === "markdown" || langLower === "md") {
          blocks.push(
            <MarkdownRenderer
              key={`nested-md-${i}`}
              content={codeText}
              openNoteByName={openNoteByName}
            />
          );
        } else {
          blocks.push(
            <CodeBlock
              key={`codeblock-${i}`}
              language={codeLanguage}
              code={codeText}
            />
          );
        }
        codeBuffer = [];
        codeLanguage = "";
      } else {
        inCodeBlock = true;
        codeLanguage = trimmed.substring(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Empty Lines
    if (!trimmed) {
      flushList();
      continue;
    }

    // Headers
    if (trimmed.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={`h1-${i}`} className="text-sm font-bold text-slate-900 dark:text-slate-100 my-2 border-b border-slate-200 dark:border-white/6 pb-1">
          {parseInline(trimmed.substring(2), openNoteByName)}
        </h1>
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2 key={`h2-${i}`} className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-300 my-1.5">
          {parseInline(trimmed.substring(3), openNoteByName)}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      blocks.push(
        <h3 key={`h3-${i}`} className="text-xs font-semibold text-slate-800 dark:text-slate-200 my-1">
          {parseInline(trimmed.substring(4), openNoteByName)}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith("#### ")) {
      flushList();
      blocks.push(
        <h4 key={`h4-${i}`} className="text-xs font-medium text-slate-700 dark:text-slate-300 my-1">
          {parseInline(trimmed.substring(5), openNoteByName)}
        </h4>
      );
      continue;
    }

    // Task Checklist Items (- [ ] or - [x])
    if (/^[-*]\s*\[[ xX]\]/.test(trimmed)) {
      flushList();
      const isChecked = /^[-*]\s*\[[xX]\]/.test(trimmed);
      const taskText = trimmed.replace(/^[-*]\s*\[[ xX]\]/, "").trim();
      blocks.push(
        <div key={`task-${i}`} className="flex items-start gap-2 text-xs my-1 bg-slate-100 dark:bg-white/2 border border-slate-200 dark:border-white/5 rounded-lg px-2.5 py-1.5">
          <CheckCircle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isChecked ? "text-emerald-500 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`} />
          <span className={isChecked ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-200"}>
            {parseInline(taskText, openNoteByName)}
          </span>
        </div>
      );
      continue;
    }

    // Unordered List Items (- or *)
    if (/^[-*]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*]\s+/, "");
      const node = <li key={`li-${i}`}>{parseInline(itemText, openNoteByName)}</li>;
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [node] };
      } else {
        currentList.items.push(node);
      }
      continue;
    }

    // Ordered List Items (1., 2.)
    if (/^\d+\.\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^\d+\.\s+/, "");
      const node = <li key={`li-${i}`}>{parseInline(itemText, openNoteByName)}</li>;
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [node] };
      } else {
        currentList.items.push(node);
      }
      continue;
    }

    // Blockquote (> )
    if (trimmed.startsWith("> ")) {
      flushList();
      const quoteText = trimmed.substring(2);
      blocks.push(
        <blockquote key={`quote-${i}`} className="my-1.5 border-l-2 border-indigo-500/60 pl-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 text-slate-700 dark:text-slate-300 italic text-xs rounded-r-md">
          {parseInline(quoteText, openNoteByName)}
        </blockquote>
      );
      continue;
    }

    // Horizontal Rule (--- or ***)
    if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
      flushList();
      blocks.push(<hr key={`hr-${i}`} className="border-slate-200 dark:border-white/8 my-2.5" />);
      continue;
    }

    // Standard Paragraph
    flushList();
    blocks.push(
      <p key={`p-${i}`} className="text-xs text-slate-800 dark:text-slate-300 leading-relaxed my-1 select-text">
        {parseInline(line, openNoteByName)}
      </p>
    );
  }

  flushList();

  // If incomplete code block was still open during streaming
  if (inCodeBlock && codeBuffer.length > 0) {
    const langLower = codeLanguage.toLowerCase();
    if (langLower === "markdown" || langLower === "md") {
      blocks.push(
        <MarkdownRenderer
          key={`nested-md-unclosed`}
          content={codeBuffer.join("\n")}
          openNoteByName={openNoteByName}
        />
      );
    } else {
      blocks.push(
        <CodeBlock
          key={`codeblock-unclosed`}
          language={codeLanguage}
          code={codeBuffer.join("\n")}
        />
      );
    }
  }

  return <div className="space-y-0.5 text-xs text-slate-800 dark:text-slate-200">{blocks}</div>;
};
