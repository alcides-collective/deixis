import { formatTool, type SessionState, type TelemetryStatus } from "@deixis/shared";

const DASHBOARD = "http://localhost:3939";

export function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const ICON: Record<TelemetryStatus, string> = {
  working: "●", waiting: "◐", errored: "✗", idle: "○", finished: "✓",
};
const COLOR: Record<TelemetryStatus, string> = {
  working: "#d08770", waiting: "#5e81ac", errored: "#bf616a", idle: "#888888", finished: "#a3be8c",
};

function needsAttention(s: SessionState): boolean {
  const st = s.telemetry?.status;
  return st === "waiting" || st === "errored";
}

function line(s: SessionState, now: number): string {
  const t = s.telemetry!;
  const age = fmtAge(Math.max(0, now - t.statusSince));
  const tool = t.currentTool ? ` ${formatTool(t.currentTool)}` : "";
  const ctx = t.contextTokens ? ` · ${fmtTokens(t.contextTokens)} ctx` : "";
  return `${ICON[t.status]} ${s.label}  ${t.status} ${age}${tool}${ctx} | color=${COLOR[t.status]}`;
}

export function renderMenu(sessions: SessionState[], now: number): string {
  const withTel = sessions.filter((s) => s.telemetry);
  const attention = withTel.filter(needsAttention);
  const active = withTel.filter((s) => s.telemetry!.status === "working");
  const rest = withTel.filter((s) => !needsAttention(s));

  const bar = attention.length ? `⚠ ${attention.length}` : `◆ ${active.length}`;
  const lines = [bar, "---"];
  for (const s of attention) lines.push(line(s, now));
  if (attention.length && rest.length) lines.push("---");
  for (const s of rest) lines.push(line(s, now));
  lines.push("---", `Open dashboard | href=${DASHBOARD}`);
  return lines.join("\n");
}

export function renderOffline(): string {
  return ["◆ – | color=#888888", "---", "Deixis: hub off", `Open dashboard | href=${DASHBOARD}`].join("\n");
}

export function diffNotifications(
  sessions: SessionState[],
  prev: Record<string, string>,
): { notifications: Array<{ label: string; status: string }>; nextCache: Record<string, string> } {
  const nextCache: Record<string, string> = {};
  const notifications: Array<{ label: string; status: string }> = [];
  for (const s of sessions) {
    const st = s.telemetry?.status;
    if (!st) continue;
    nextCache[s.sessionId] = st;
    if ((st === "errored" || st === "finished") && prev[s.sessionId] !== st) {
      notifications.push({ label: s.label, status: st });
    }
  }
  return { notifications, nextCache };
}
