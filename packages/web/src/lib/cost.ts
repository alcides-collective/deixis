import type { TelemetryStatus } from "@deixis/shared";

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const COLOR: Record<TelemetryStatus, string> = {
  working: "bg-status-active",
  waiting: "bg-status-waiting",
  idle: "bg-status-blocked",
  errored: "bg-status-failed",
  finished: "bg-status-done",
};

export function statusColor(status: TelemetryStatus): string {
  return COLOR[status];
}
