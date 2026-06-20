import type { TelemetryStatus } from "@deixis/shared";
import { statusColor } from "../lib/cost.js";

export function StatusPill({ status }: { status: TelemetryStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
      <span className={`size-2 rounded-full ${statusColor(status)}`} />
      {status}
    </span>
  );
}
