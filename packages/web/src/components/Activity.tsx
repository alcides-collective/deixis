import type { SessionTelemetry } from "@deixis/shared";
import { formatTokens, formatUsd } from "../lib/cost.js";

export function Activity({ t }: { t: SessionTelemetry }) {
  const total = t.usage.input + t.usage.output + t.usage.cacheCreate + t.usage.cacheRead;
  return (
    <div className="flex flex-col gap-2 text-[12px] text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>{formatTokens(total)} tok</span>
        <span title="equivalent API cost">{formatUsd(t.costUsd)}</span>
      </div>
      {t.currentTool ? (
        <div className="truncate">
          <span className="font-mono text-foreground">{t.currentTool}</span>
        </div>
      ) : null}
      {t.lastMessage ? <div className="line-clamp-2 italic">{t.lastMessage}</div> : null}
      {t.recentTools?.length ? (
        <div className="flex flex-wrap gap-1">
          {t.recentTools.map((tool, i) => (
            <span key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {tool}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
