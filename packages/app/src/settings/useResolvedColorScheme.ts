import { useEffect, useState } from "react";
import { useSettingsStore } from "./useSettingsStore";

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Returns the resolved "light" | "dark" based on settings + OS preference. */
export function useResolvedColorScheme(): "light" | "dark" {
  const colorScheme = useSettingsStore((s) => s.settings.general.colorScheme);
  const [systemDark, setSystemDark] = useState(getSystemDark);

  useEffect(() => {
    if (colorScheme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => { setSystemDark(e.matches); };
    mq.addEventListener("change", handler);
    return () => { mq.removeEventListener("change", handler); };
  }, [colorScheme]);

  if (colorScheme === "system") return systemDark ? "dark" : "light";
  return colorScheme;
}
