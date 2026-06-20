import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme.js";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="rounded-[var(--radius)] border p-2 transition-colors duration-300 hover:bg-muted"
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
