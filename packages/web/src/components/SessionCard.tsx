import type { SessionState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";
import { ProgressList } from "./ProgressList.js";
import { StatusPill } from "./StatusPill.js";
import { Activity } from "./Activity.js";

export function SessionCard({ session }: { session: SessionState }) {
  return (
    <article
      className={`flex flex-col gap-4 rounded-[var(--radius)] border bg-background p-5 ${
        session.online ? "" : "opacity-50"
      }`}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium">{session.label}</h2>
        {session.telemetry ? (
          <StatusPill status={session.telemetry.status} />
        ) : (
          <span
            className={`size-2 rounded-full ${
              session.online ? "bg-status-done" : "bg-status-blocked"
            }`}
          />
        )}
      </header>
      {session.telemetry ? <Activity t={session.telemetry} /> : null}
      {session.hasCanvas ? <ProgressList steps={session.steps} /> : null}
      {session.hasCanvas && session.markdown ? (
        <div
          className="prose-deixis text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(session.markdown) }}
        />
      ) : null}
    </article>
  );
}
