import { useEffect } from "react";
import type { Layout } from "../lib/layout.js";

export function SettingsPanel({
  theme,
  onToggleTheme,
  layout,
  onSetLayout,
  onClose,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  layout: Layout;
  onSetLayout: (l: Layout) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const opt = (active: boolean) =>
    `flex-1 rounded-[var(--radius)] border px-3 py-2 text-[13px] ${active ? "bg-muted" : "hover:bg-muted"}`;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <article
        className="my-16 h-fit w-full max-w-[420px] rounded-[var(--radius)] border bg-background p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-5 flex items-center justify-between border-b pb-3">
          <h2 className="text-[14px] font-medium">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </header>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
            Appearance
          </h3>
          <div className="flex gap-2">
            <button
              className={opt(theme === "light")}
              onClick={() => {
                if (theme !== "light") onToggleTheme();
              }}
            >
              Light
            </button>
            <button
              className={opt(theme === "dark")}
              onClick={() => {
                if (theme !== "dark") onToggleTheme();
              }}
            >
              Dark
            </button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
            Layout
          </h3>
          <div className="flex gap-2">
            <button className={opt(layout === "feed")} onClick={() => onSetLayout("feed")}>
              Feed
            </button>
            <button className={opt(layout === "masonry")} onClick={() => onSetLayout("masonry")}>
              Masonry
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Feed is a single centered column. Masonry packs cards into multiple columns.
          </p>
        </section>
      </article>
    </div>
  );
}
