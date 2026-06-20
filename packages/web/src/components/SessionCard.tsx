import type { SessionState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";
import { ProgressList } from "./ProgressList.js";

export function SessionCard({ session }: { session: SessionState }) {
  return (
    <article
      className={`flex flex-col gap-4 rounded-[var(--radius)] border bg-background p-5 ${
        session.online ? "" : "opacity-50"
      }`}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium">{session.label}</h2>
        <span
          className={`size-2 rounded-full ${
            session.online ? "bg-status-done" : "bg-status-blocked"
          }`}
        />
      </header>
      <ProgressList steps={session.steps} />
      {session.markdown ? (
        <div
          className="prose-deixis text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(session.markdown) }}
        />
      ) : null}
    </article>
  );
}
