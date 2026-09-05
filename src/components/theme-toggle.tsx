"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

// resolvedTheme, not theme: "system" is a real value of `theme`, and a control
// offering to "switch to system" tells the person nothing about what they will
// see. resolvedTheme is always a concrete "light" or "dark".
//
// The label names the theme you will GET, not the one you are in — a button
// labelled with the current state reads as a status display, and people do not
// press status displays.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // "Have we hydrated yet?" The server cannot know the device preference, so
  // the first client render must match the server's — rendering the label
  // early produces a hydration mismatch and briefly names the wrong theme.
  //
  // useSyncExternalStore rather than the usual setState-in-an-effect mount
  // guard: that pattern triggers a cascading render and this repo's lint
  // rejects it (react-hooks/set-state-in-effect). Here the server snapshot is
  // false, the client snapshot is true, and nothing ever changes after, so the
  // subscribe function has nothing to do.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const next = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={mounted ? `Switch to ${next} theme` : "Switch theme"}
      className="rounded-sm border border-border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
    >
      <span aria-hidden={!mounted} className={mounted ? undefined : "invisible"}>
        {mounted ? next : "dark"}
      </span>
    </button>
  );
}
