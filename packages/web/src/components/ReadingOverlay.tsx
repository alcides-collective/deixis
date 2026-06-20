import { useEffect } from "react";
import { Close } from "@carbon/icons-react";
import type { DocumentState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";

export function ReadingOverlay({ doc, onClose }: { doc: DocumentState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <article
        className="my-10 h-fit w-full max-w-[760px] rounded-[var(--radius)] border bg-background p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between border-b pb-3">
          <h2 className="font-mono text-[13px] text-muted-foreground">{doc.title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <Close size={20} />
          </button>
        </header>
        <div
          className="prose-deixis min-w-0 max-w-full text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.markdown) }}
        />
        <footer className="mt-6 border-t pt-3 text-[12px] text-muted-foreground">
          Reviewing <span className="font-mono">{doc.path}</span> — reply in your Claude Code session.
        </footer>
      </article>
    </div>
  );
}
