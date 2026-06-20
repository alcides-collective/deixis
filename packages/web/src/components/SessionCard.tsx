import { useState } from "react";
import type { SessionState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";
import { ProgressList } from "./ProgressList.js";
import { StatusPill } from "./StatusPill.js";
import { Activity } from "./Activity.js";

export function SessionCard({ session }: { session: SessionState }) {
  const [collapsed, setCollapsed] = useState(false);
  const collapsible = !!session.telemetry || session.hasCanvas;

  return (
    <article
      className={`flex min-w-0 flex-col gap-4 rounded-[var(--radius)] border bg-background p-5 ${
        session.online ? "" : "opacity-50"
      }`}
    >
      <header
        className={`flex items-center justify-between ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        aria-expanded={collapsible ? !collapsed : undefined}
        title={collapsible ? (collapsed ? "Expand" : "Collapse") : undefined}
      >
        <h2 className="flex items-center gap-2 text-[15px] font-medium">
          {collapsible ? (
            <span className="w-2 text-[10px] text-muted-foreground">{collapsed ? "▸" : "▾"}</span>
          ) : null}
          {session.label}
        </h2>
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

      {!collapsed ? (
        <>
          {session.telemetry ? <Activity t={session.telemetry} /> : null}
          {session.hasCanvas ? <ProgressList steps={session.steps} /> : null}
          {session.hasCanvas && session.markdown ? (
            <div
              className="prose-deixis min-w-0 max-w-full text-[14px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(session.markdown) }}
            />
          ) : null}
        </>
      ) : null}
    </article>
  );
}
