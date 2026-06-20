import type { SessionState } from "@deixis/shared";
import { formatTokens, formatUsd } from "../lib/cost.js";

export function AggregateBar({ sessions }: { sessions: SessionState[] }) {
  const active = sessions.filter((s) => s.telemetry?.status === "working").length;
  let tokens = 0;
  let cost = 0;
  for (const s of sessions) {
    const u = s.telemetry?.usage;
    if (u) tokens += u.input + u.output + u.cacheCreate + u.cacheRead;
    if (s.telemetry?.costUsd) cost += s.telemetry.costUsd;
  }
  return (
    <div className="flex items-center gap-6 border-b px-4 py-2 text-[12px] text-muted-foreground">
      <span>{sessions.length} sessions</span>
      <span>{active} working</span>
      <span>{formatTokens(tokens)} tok</span>
      <span title="equivalent API cost">{formatUsd(cost)}</span>
    </div>
  );
}
