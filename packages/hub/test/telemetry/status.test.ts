import { describe, it, expect } from "vitest";
import { StatusEngine } from "../../src/telemetry/status.js";

describe("StatusEngine.applyEvent", () => {
  it("maps events to states", () => {
    const e = new StatusEngine();
    expect(e.applyEvent("s", "PreToolUse", 0)).toBe("working");
    expect(e.applyEvent("s", "UserPromptSubmit", 0)).toBe("working");
    expect(e.applyEvent("s", "Notification", 0)).toBe("waiting");
    expect(e.applyEvent("s", "Stop", 0)).toBe("idle");
    expect(e.applyEvent("s", "SessionStart", 0)).toBe("idle");
  });
});

describe("StatusEngine.tick (age-out)", () => {
  it("working -> idle after 120s, idle -> finished after 1h", () => {
    const e = new StatusEngine();
    e.applyEvent("s", "PreToolUse", 0);
    expect(e.tick(119_000).get("s")).toBeUndefined();        // not yet
    expect(e.tick(120_001).get("s")).toBe("idle");           // aged to idle
    expect(e.tick(120_001 + 3_600_001).get("s")).toBe("finished");
  });
});

describe("StatusEngine.classifyFallback", () => {
  it("errors and finishes override", () => {
    const e = new StatusEngine();
    expect(e.classifyFallback("working", { pidAlive: true, hasError: true })).toBe("errored");
    expect(e.classifyFallback("idle", { pidAlive: false, hasError: false })).toBe("finished");
    expect(e.classifyFallback("working", { pidAlive: true, hasError: false })).toBe("working");
  });
});
