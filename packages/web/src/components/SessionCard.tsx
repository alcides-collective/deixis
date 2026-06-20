import { useState } from "react";
import { ChevronDown, ChevronRight, Document } from "@carbon/icons-react";
import type { SessionState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";
import { ProgressList } from "./ProgressList.js";
import { StatusPill } from "./StatusPill.js";
import { Activity } from "./Activity.js";

export function SessionCard({
  session,
  onOpenDoc,
}: {
  session: SessionState;
  onOpenDoc?: () => void;
}) {
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
            <span className="text-muted-foreground">
              {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </span>
          ) : null}
          {session.label}
        </h2>
        <span className="flex items-center gap-2">
        {session.document && onOpenDoc ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDoc();
            }}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title={`Open ${session.document.title}`}
          >
            <Document size={14} /> doc
          </button>
        ) : null}
        {session.telemetry ? (
          <StatusPill status={session.telemetry.status} />
        ) : (
          <span
            className={`size-2 rounded-full ${
              session.online ? "bg-status-done" : "bg-status-blocked"
            }`}
          />
        )}
        </span>
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
