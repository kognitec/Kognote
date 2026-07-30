/**
 * Stateful Stream Action Buffer for KogNote Copilot.
 * Safely buffers incoming streaming tokens (SSE), extracts completed [ACTION: ...] tags
 * without syntax truncation, and keeps incomplete trailing tags buffered until complete.
 */

export interface ParsedStreamAction {
  action: string;
  args: any;
  rawTag: string;
}

export class StreamActionBuffer {
  private rawBuffer = "";
  private cleanText = "";
  private executedTags = new Set<string>();

  /**
   * Append incoming token chunk to internal buffer.
   */
  public append(token: string): { newCleanTokens: string; completedActions: ParsedStreamAction[] } {
    this.rawBuffer += token;
    return this.processBuffer();
  }

  /**
   * Process current buffer, extracting completed actions and returning new clean conversation tokens.
   */
  private processBuffer(): { newCleanTokens: string; completedActions: ParsedStreamAction[] } {
    const completedActions: ParsedStreamAction[] = [];
    let textToScan = this.rawBuffer;

    let index = 0;
    let lastCleanIndex = 0;
    let accumulatedClean = "";

    while (true) {
      const actionIdx = textToScan.indexOf("[ACTION:", index);
      if (actionIdx === -1) {
        // No more action start tags. Text up to potential partial tag is safe clean text.
        // Check if there's a trailing '[' at the very end
        const trailingBraceIdx = textToScan.lastIndexOf("[");
        if (trailingBraceIdx !== -1 && trailingBraceIdx >= lastCleanIndex && textToScan.slice(trailingBraceIdx).startsWith("[ACT")) {
          // Keep trailing partial tag buffered
          accumulatedClean += textToScan.slice(lastCleanIndex, trailingBraceIdx);
          this.rawBuffer = textToScan.slice(trailingBraceIdx);
        } else {
          accumulatedClean += textToScan.slice(lastCleanIndex);
          this.rawBuffer = "";
        }
        break;
      }

      // Found [ACTION:
      accumulatedClean += textToScan.slice(lastCleanIndex, actionIdx);

      const commaIdx = textToScan.indexOf(",", actionIdx);
      if (commaIdx === -1) {
        // Incomplete action name, leave buffered
        this.rawBuffer = textToScan.slice(actionIdx);
        break;
      }

      const actionName = textToScan.slice(actionIdx + 8, commaIdx).trim();
      const startBraceIdx = textToScan.indexOf("{", commaIdx);
      if (startBraceIdx === -1) {
        // Incomplete args start, leave buffered
        this.rawBuffer = textToScan.slice(actionIdx);
        break;
      }

      // Find matching closing brace for JSON object
      let depth = 0;
      let inString = false;
      let escape = false;
      let endBraceIdx = -1;

      for (let i = startBraceIdx; i < textToScan.length; i++) {
        const char = textToScan[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\") {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === "{") depth++;
          else if (char === "}") {
            depth--;
            if (depth === 0) {
              endBraceIdx = i;
              break;
            }
          }
        }
      }

      if (endBraceIdx === -1) {
        // Incomplete JSON object payload, leave buffered
        this.rawBuffer = textToScan.slice(actionIdx);
        break;
      }

      // Find closing bracket ] after JSON payload
      const closingBracketIdx = textToScan.indexOf("]", endBraceIdx);
      if (closingBracketIdx === -1) {
        this.rawBuffer = textToScan.slice(actionIdx);
        break;
      }

      const rawTag = textToScan.slice(actionIdx, closingBracketIdx + 1);
      const jsonPayloadStr = textToScan.slice(startBraceIdx, endBraceIdx + 1);

      if (!this.executedTags.has(rawTag)) {
        this.executedTags.add(rawTag);
        try {
          const cleanJson = jsonPayloadStr
            .replace(/,\s*([}\]])/g, "$1")
            .replace(/```json/gi, "")
            .replace(/```/g, "");
          const args = JSON.parse(cleanJson);
          completedActions.push({
            action: actionName,
            args,
            rawTag,
          });
        } catch (err) {
          console.warn("StreamActionBuffer JSON parse failed for tag:", rawTag, err);
        }
      }

      index = closingBracketIdx + 1;
      lastCleanIndex = index;
    }

    this.cleanText += accumulatedClean;
    return {
      newCleanTokens: accumulatedClean,
      completedActions,
    };
  }

  /**
   * Return entire accumulated clean conversation text without action tags.
   */
  public getCleanText(): string {
    return this.cleanText;
  }

  /**
   * Finalize buffer processing at end of stream.
   */
  public flush(): { finalCleanText: string; remainingActions: ParsedStreamAction[] } {
    const res = this.processBuffer();
    // Clear any leftover unparsed raw buffer text from clean text
    const clean = this.cleanText.replace(/\[ACTION:[\s\S]*?\]/g, "").trim();
    return {
      finalCleanText: clean,
      remainingActions: res.completedActions,
    };
  }
}
