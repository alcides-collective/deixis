import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function initial(): Theme {
  const saved = localStorage.getItem("deixis-theme") as Theme | null;
  if (saved) return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("deixis-theme", theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
