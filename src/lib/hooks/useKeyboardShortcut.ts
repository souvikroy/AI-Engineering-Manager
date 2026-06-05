"use client";

import { useEffect } from "react";

type ShortcutOpts = {
  /** Lowercase letter (e.g. "b") or special key like "Escape". Compared case-insensitive against `e.key`. */
  key: string;
  meta?: boolean; // requires Cmd (mac) OR Ctrl (others) — matches both
  shift?: boolean;
  alt?: boolean;
  /** Skip when focus is in a textarea / input / contenteditable. Default false (pressing Cmd+B in the textarea should still toggle). */
  skipInInputs?: boolean;
};

/**
 * Register a global keyboard shortcut for the lifetime of the component.
 * Re-registers if `handler` reference changes.
 */
export function useKeyboardShortcut(opts: ShortcutOpts, handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== opts.key.toLowerCase()) return;
      const metaOk = opts.meta ? e.metaKey || e.ctrlKey : true;
      const shiftOk = opts.shift ? e.shiftKey : !e.shiftKey || true;
      const altOk = opts.alt ? e.altKey : true;
      if (!metaOk || !shiftOk || !altOk) return;
      if (opts.skipInInputs) {
        const t = e.target as HTMLElement | null;
        if (t) {
          const tag = t.tagName;
          const editable = (t as HTMLElement).isContentEditable;
          if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;
        }
      }
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    opts.key,
    opts.meta,
    opts.shift,
    opts.alt,
    opts.skipInInputs,
    handler,
  ]);
}
