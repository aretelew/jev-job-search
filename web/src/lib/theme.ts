import { useEffect, useState } from "react";

const query = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Follows the system's light or dark setting, and keeps the `dark` class on the page in step. */
export function useSystemTheme(): "light" | "dark" {
  const [dark, setDark] = useState(() => query().matches);
  useEffect(() => {
    const q = query();
    const on = () => setDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return dark ? "dark" : "light";
}
