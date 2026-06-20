import { describe, it, expect } from "vitest";
import { SessionStore } from "../../src/store.js";
import { pidAlive, sweepFinished } from "../../src/telemetry/sweep.js";

describe("pidAlive", () => {
  it("is true for the current process and false for a bogus pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 30)).toBe(false);
  });
});

describe("sweepFinished", () => {
  it("marks sessions with dead pids as finished", () => {
    const store = new SessionStore();
    store.ensureSession("alive");
    store.setTelemetry("alive", { status: "working", pid: process.pid });
    store.ensureSession("dead");
    store.setTelemetry("dead", { status: "working", pid: 2 ** 30 });
    const finished = sweepFinished(store);
    expect(finished).toEqual(["dead"]);
    expect(store.getAll().find((s) => s.sessionId === "dead")?.telemetry?.status).toBe("finished");
    expect(store.getAll().find((s) => s.sessionId === "alive")?.telemetry?.status).toBe("working");
  });
});
