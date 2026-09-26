"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// True only after hydration: the theme is unknown during server rendering, so the icon is
// rendered on the client only (avoids a hydration mismatch).
const subscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribe, () => true, () => false);

/** Switches between light and dark mode (the choice is remembered by next-themes). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isClient = useIsClient();
  const dark = isClient && resolvedTheme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("rounded-full", className)}
      aria-label={label}
      title={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {isClient ? dark ? <SunIcon /> : <MoonIcon /> : <span className="size-4" />}
    </Button>
  );
}
