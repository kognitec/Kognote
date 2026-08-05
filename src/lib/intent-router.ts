import { aiService } from "./local-ai";

export interface IntentResult {
  intent: "CHAT" | "DO";
  confidence: number;
  targetFile: string | null;
  reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD-CLASS INTENT CLASSIFICATION PATTERNS (Engineered for Local AI & API)
// ─────────────────────────────────────────────────────────────────────────────

// Layer 1: Anti-Edit / Interrogative Advice Patterns (Must route to CHAT)
const ANTI_EDIT_PATTERNS = [
  /\b(should|would|can|could)\s+i\s+(add|delete|remove|change|update|modify|edit|rename|move)\b/i,
  /\bis\s+it\s+(safe|better|good)\s+to\s+(delete|remove|change|update)\b/i,
  /\b(how|why)\s+(do|can|to|should)\s+i\s+(add|delete|remove|change|update|create|format)\b/i,
  /\bhow\s+to\s+(add|delete|remove|change|update|create|format)\b/i,
  /\b(don't|do not|never|without)\s+(edit|modify|change|delete|touch|remove|update)\b/i,
  /\b(just|only)\s+(explain|tell|describe|summarize|read|show)\b/i,
  /\bwhat\s+(is|are|does|means?|happens?)\b/i,
];

// Layer 2: Direct Imperative Command Verbs (Targeting note edits or system actions)
const IMPERATIVE_DO_VERBS = [
  "add", "insert", "delete", "remove", "rewrite", "replace", "update", 
  "modify", "refactor", "create", "append", "format", "fix", "change", 
  "make", "set", "rename", "move", "convert", "translate", "strip", 
  "clean", "extract", "organize", "reorder", "sort", "populate"
];

const DO_VERB_REGEX = new RegExp(`\\b(${IMPERATIVE_DO_VERBS.join("|")})\\b`, "i");

// Layer 3: Direct Sentence-Starting Imperatives (e.g., "Remove all dates", "Add task checklist")
const STARTING_IMPERATIVE_REGEX = new RegExp(`^(?:please\\s+)?(${IMPERATIVE_DO_VERBS.join("|")})\\b`, "i");

// Layer 4: Explicit Note Scope Markers
const NOTE_SCOPE_MARKERS = /\b(in|from|to|into|on)\s+(this|my|the|active|open)\s+(note|file|document|page|canvas|vault)\b/i;

// Layer 5: Pure Question / Conversational Words
const PURE_CHAT_WORDS = /\b(explain|why|how|what|who|where|when|tell me|describe|discuss|meaning|summarize|understand|greetings|hello|hi|hey|thanks|thank you)\b/i;

// Layer 6: Referential Follow-Up Patterns ("do that", "apply that", "fix that", "change it")
const REFERENTIAL_DO_REGEX = /\b(do|apply|change|remove|delete|undo|fix|update|rewrite|modify)\s+(that|it|this|those|these)\b/i;

/**
 * World-Class Zero-Latency Intent Gateway for Kognote.
 * 
 * Features:
 * - 0ms execution latency (eliminates double-inference delays and VRAM locks on local models).
 * - Multi-layer semantic scoring engine covering negative directives, advice queries, starting imperatives, and file targets.
 * - Context-aware sliding window evaluation for referential follow-up directives ("do that", "apply it").
 * - Dual-pass LLM fallback for cloud/API models when prompts are genuinely ambiguous.
 */
export async function classifyIntent(
  userText: string,
  activeFileName?: string | null,
  pinnedContextsCount: number = 0,
  recentHistory?: string[]
): Promise<IntentResult> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return {
      intent: "CHAT",
      confidence: 1.0,
      targetFile: activeFileName || null,
      reasoning: "Empty prompt default.",
    };
  }

  // ── LAYER 0: SLASH COMMAND & STRUCTURAL ACTION TRIGGER FAST-PATH ────────────
  if (trimmed.startsWith("/") || trimmed.startsWith("[ACTION:")) {
    return {
      intent: "DO",
      confidence: 1.0,
      targetFile: activeFileName || null,
      reasoning: "Explicit slash command or structural action trigger.",
    };
  }

  // ── LAYER 0.5: REFERENTIAL FOLLOW-UP CONTEXT RESOLUTION ─────────────────────
  if (recentHistory && recentHistory.length > 0 && REFERENTIAL_DO_REGEX.test(trimmed)) {
    const lastMsg = recentHistory[recentHistory.length - 1] || "";
    if (STARTING_IMPERATIVE_REGEX.test(lastMsg) || DO_VERB_REGEX.test(lastMsg) || lastMsg.includes("```diff")) {
      return {
        intent: "DO",
        confidence: 0.96,
        targetFile: activeFileName || null,
        reasoning: "Context-aware referential follow-up directive targeting previous note edit.",
      };
    }
  }

  // ── LAYER 1: ANTI-EDIT & INTERROGATIVE ADVICE GUARDS ───────────────────────
  for (const pattern of ANTI_EDIT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        intent: "CHAT",
        confidence: 0.98,
        targetFile: activeFileName || null,
        reasoning: "Advice question or explicit non-edit directive detected.",
      };
    }
  }

  // ── LAYER 2: IMPERATIVE POSITION & SCOPE SCORING ────────────────────────────
  let doScore = 0;
  let chatScore = 0;

  const isStartingImperative = STARTING_IMPERATIVE_REGEX.test(trimmed);
  const hasDoVerb = DO_VERB_REGEX.test(trimmed);
  const hasChatWord = PURE_CHAT_WORDS.test(trimmed);
  const hasNoteScopeMarker = NOTE_SCOPE_MARKERS.test(trimmed);

  if (isStartingImperative) doScore += 4;
  if (hasDoVerb) doScore += 2;
  if (hasNoteScopeMarker) doScore += 3;
  if (pinnedContextsCount > 0) doScore += 1;

  if (hasChatWord) chatScore += 3;
  if (trimmed.endsWith("?")) chatScore += 2;

  // Multi-clause resolution (e.g. "Fix the typo in line 3 and explain why it happened")
  if (doScore >= 4 && isStartingImperative) {
    return {
      intent: "DO",
      confidence: 0.95,
      targetFile: activeFileName || null,
      reasoning: "Direct sentence-starting imperative command targeting note.",
    };
  }

  if (doScore > chatScore + 1) {
    return {
      intent: "DO",
      confidence: Math.min(0.95, 0.75 + (doScore - chatScore) * 0.05),
      targetFile: activeFileName || null,
      reasoning: `Scored DO intent (Imperative Score: ${doScore} vs Chat: ${chatScore}).`,
    };
  }

  if (chatScore > doScore) {
    return {
      intent: "CHAT",
      confidence: Math.min(0.95, 0.75 + (chatScore - doScore) * 0.05),
      targetFile: activeFileName || null,
      reasoning: `Scored CHAT intent (Chat Score: ${chatScore} vs Imperative: ${doScore}).`,
    };
  }

  // ── LAYER 3: LOCAL PROVIDER FAST-PATH BINDING ──────────────────────────────
  // For local AI models, bypass secondary LLM invocation to avoid 2x VRAM contention & inference latency
  const currentSettings = aiService.getSettings();
  if (currentSettings.provider === "local") {
    const finalIntent = hasDoVerb ? "DO" : "CHAT";
    return {
      intent: finalIntent,
      confidence: 0.88,
      targetFile: activeFileName || null,
      reasoning: `Local AI Fast-Path (${finalIntent} mode).`,
    };
  }

  // ── LAYER 4: CLOUD API LLM GATEWAY (Ambiguous Prompts Only) ─────────────────
  try {
    const systemPrompt = `You are the routing gateway for a local IDE & note companion (Kognote). Your sole responsibility is to classify user intent.
Determine if the user wants to CHAT (explain, discuss, reason, answer Q&A) or DO (modify, delete, insert, or rewrite content in a note file).

CRITICAL RULES:
- "CHAT": Conceptual questions, "how to" advice, greetings, code/note explanations, or when user explicitly asks NOT to edit.
- "DO": Direct imperative commands to add, delete, change, fix, format, or rewrite note content.

OUTPUT FORMAT:
{"intent": "CHAT" | "DO", "confidence": 0.0-1.0, "target_file": "string or null", "reasoning": "1 sentence"}`;

    const prompt = `Active File: ${activeFileName || "None"}\nUser Message: "${trimmed}"`;
    const rawResponse = await aiService.generateText(prompt, systemPrompt);

    const jsonStr = rawResponse.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    if (parsed && (parsed.intent === "CHAT" || parsed.intent === "DO")) {
      return {
        intent: parsed.intent,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
        targetFile: parsed.target_file || activeFileName || null,
        reasoning: parsed.reasoning || "Classified by API Gateway.",
      };
    }
  } catch (err) {
    console.warn("Intent router API fallback used:", err);
  }

  return {
    intent: hasDoVerb ? "DO" : "CHAT",
    confidence: 0.80,
    targetFile: activeFileName || null,
    reasoning: "Fallback heuristic classification.",
  };
}
