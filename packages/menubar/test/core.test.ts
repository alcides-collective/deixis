import { describe, it, expect } from "vitest";
import { renderMenu, renderOffline, diffNotifications, fmtAge, fmtTokens } from "../src/core.js";
import type { SessionState } from "@deixis/shared";

function sess(p: Partial<SessionState> & { sessionId: string; label: string }): SessionState {
  return {
    sessionId: p.sessionId, label: p.label, markdown: "", steps: [],
    connectedAt: 0, online: true, hasCanvas: false, hasTelemetry: true,
    telemetry: p.telemetry,
  } as SessionState;
}

const t = (status: string, statusSince: number, currentTool?: string, contextTokens = 0) => ({
  status, statusSince, currentTool, contextTokens,
  usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, costUsd: null, updatedAt: 0,
}) as SessionState["telemetry"];

describe("fmtAge / fmtTokens", () => {
  it("formats ages", () => {
    expect(fmtAge(12_000)).toBe("12s");
    expect(fmtAge(180_000)).toBe("3m");
    expect(fmtAge(3_600_000)).toBe("1h");
  });
  it("formats tokens", () => {
    expect(fmtTokens(900)).toBe("900");
    expect(fmtTokens(48_000)).toBe("48k");
    expect(fmtTokens(1_100_000)).toBe("1.1M");
  });
});

describe("renderMenu", () => {
  it("uses ◆ + active count when nothing needs attention", () => {
    const out = renderMenu([sess({ sessionId: "a", label: "p", telemetry: t("working", 0) })], 0);
    expect(out.split("\n")[0]).toContain("◆ 1");
  });

  it("uses ⚠ + attention count when a session waits or errors", () => {
    const out = renderMenu([
      sess({ sessionId: "a", label: "p", telemetry: t("working", 0) }),
      sess({ sessionId: "b", label: "q", telemetry: t("waiting", 0) }),
    ], 0);
    expect(out.split("\n")[0]).toContain("⚠ 1");
  });

  it("pins waiting/errored sessions above the rest and includes an Open dashboard link", () => {
    const out = renderMenu([
      sess({ sessionId: "a", label: "calm", telemetry: t("idle", 0) }),
      sess({ sessionId: "b", label: "needsme", telemetry: t("errored", 0) }),
    ], 0);
    const body = out.indexOf("calm");
    const attn = out.indexOf("needsme");
    expect(attn).toBeGreaterThan(-1);
    expect(attn).toBeLessThan(body); // errored listed first
    expect(out).toContain("http://localhost:3939");
  });

  it("renders no $ sign anywhere", () => {
    const out = renderMenu([sess({ sessionId: "a", label: "p", telemetry: t("working", 0, "Bash", 48000) })], 0);
    expect(out).not.toContain("$");
  });
});

describe("renderOffline", () => {
  it("shows a hub-off menu", () => {
    const out = renderOffline();
    expect(out.split("\n")[0]).toMatch(/◆/);
    expect(out.toLowerCase()).toContain("hub off");
  });
});

describe("diffNotifications", () => {
  it("fires once on a new transition to errored/finished", () => {
    const sessions = [
      sess({ sessionId: "a", label: "p", telemetry: t("errored", 0) }),
      sess({ sessionId: "b", label: "q", telemetry: t("finished", 0) }),
      sess({ sessionId: "c", label: "r", telemetry: t("working", 0) }),
    ];
    const { notifications, nextCache } = diffNotifications(sessions, {});
    expect(notifications.map((n) => n.label).sort()).toEqual(["p", "q"]);
    expect(nextCache).toEqual({ a: "errored", b: "finished", c: "working" });
  });

  it("does not re-fire when status is unchanged", () => {
    const sessions = [sess({ sessionId: "a", label: "p", telemetry: t("errored", 0) })];
    const { notifications } = diffNotifications(sessions, { a: "errored" });
    expect(notifications).toHaveLength(0);
  });
});
