/**
 * Helper to check if the current platform is macOS / iOS
 */
export const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") return false;
  // Modern userAgentData API check
  const uaDataPlatform = (navigator as any).userAgentData?.platform;
  if (uaDataPlatform) {
    return /macOS|iOS/i.test(uaDataPlatform);
  }
  // Standard userAgent fallback
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform || "");
};

/**
 * Cross-platform keyboard event helper.
 * Returns true if the platform's primary modifier key is pressed:
 * - Meta (Cmd ⌘) on macOS / iOS
 * - Control (Ctrl) on Windows, Linux, Android
 */
export const isModKey = (e: KeyboardEvent | React.KeyboardEvent): boolean => {
  return isMacPlatform() ? e.metaKey : e.ctrlKey;
};

/**
 * Returns the display string for the primary modifier key on the current OS
 * ("⌘" on macOS, "Ctrl" on Windows/Linux)
 */
export const getModKeySymbol = (): string => {
  return isMacPlatform() ? "⌘" : "Ctrl";
};

