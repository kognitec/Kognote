/**
 * Cross-platform keyboard event helper.
 * Returns true if the platform's primary modifier key is pressed:
 * - Meta (Cmd ⌘) on macOS / iOS
 * - Control (Ctrl) on Windows, Linux, Android
 */
export const isModKey = (e: KeyboardEvent | React.KeyboardEvent): boolean => {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform || "");
  return isMac ? e.metaKey : e.ctrlKey;
};

/**
 * Returns the display string for the primary modifier key on the current OS
 * ("⌘" on macOS, "Ctrl" on Windows/Linux)
 */
export const getModKeySymbol = (): string => {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform || "");
  return isMac ? "⌘" : "Ctrl";
};
