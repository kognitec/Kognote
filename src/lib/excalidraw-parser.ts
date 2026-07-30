/**
 * Excalidraw JSON Canvas to Clean Text/Node-Edge Graph Parser for Kognote.
 * Converts raw canvas JSON into a concise summary suitable for LLM context.
 */

export interface ExcalidrawCanvasSummary {
  textNodes: string[];
  connections: Array<{ source: string; target: string }>;
  rawElementCount: number;
}

export function parseExcalidrawCanvas(jsonContent: string): string {
  if (!jsonContent) return "Empty Canvas";

  try {
    const data = JSON.parse(jsonContent);
    const elements = Array.isArray(data.elements) ? data.elements : [];

    const textNodes: string[] = [];
    const idToText = new Map<string, string>();
    const edges: Array<{ from: string; to: string }> = [];

    for (const el of elements) {
      if (el.type === "text" && el.text) {
        const cleanText = el.text.trim();
        if (cleanText) {
          textNodes.push(cleanText);
          idToText.set(el.id, cleanText);
        }
      }
    }

    for (const el of elements) {
      if ((el.type === "arrow" || el.type === "line") && el.startBinding && el.endBinding) {
        const fromText = idToText.get(el.startBinding.elementId) || "Node";
        const toText = idToText.get(el.endBinding.elementId) || "Node";
        edges.push({ from: fromText, to: toText });
      }
    }

    let summary = `🎨 Canvas Drawing (${elements.length} elements):\n`;
    if (textNodes.length > 0) {
      summary += `• Text Nodes: ${textNodes.join(" | ")}\n`;
    }
    if (edges.length > 0) {
      summary += `• Visual Flow Connections: ${edges.map((e) => `[${e.from}] ──► [${e.to}]`).join(", ")}\n`;
    }
    return summary;
  } catch (err) {
    return "Non-JSON or legacy Excalidraw canvas content.";
  }
}
