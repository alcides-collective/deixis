import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/store.js";

describe("SessionStore.register", () => {
  it("creates an online session with the given label", () => {
    const store = new SessionStore();
    const s = store.register("id-1", "deixis");
    expect(s.label).toBe("deixis");
    expect(s.online).toBe(true);
    expect(s.markdown).toBe("");
    expect(s.steps).toEqual([]);
  });

  it("disambiguates duplicate labels across distinct sessions", () => {
    const store = new SessionStore();
    store.register("id-1", "deixis");
    const s2 = store.register("id-2", "deixis");
    expect(s2.label).toBe("deixis-2");
  });

  it("emits a session event on register", () => {
    const store = new SessionStore();
    const events: unknown[] = [];
    store.on("event", (e) => events.push(e));
    store.register("id-1", "deixis");
    expect(events).toContainEqual({
      type: "session",
      session: expect.objectContaining({ sessionId: "id-1", label: "deixis" }),
    });
  });
});

describe("SessionStore mutations", () => {
  it("sets markdown", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    const s = store.setMarkdown("id-1", "# hi");
    expect(s.markdown).toBe("# hi");
  });

  it("sets progress steps", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    const s = store.setProgress("id-1", [
      { id: "1", name: "parse", status: "pending" },
    ]);
    expect(s.steps[0].name).toBe("parse");
  });

  it("stamps startedAt on -> active and endedAt on -> done", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    store.setProgress("id-1", [{ id: "1", name: "parse", status: "pending" }]);
    const active = store.updateStep("id-1", "1", "active");
    expect(active.steps[0].startedAt).toBeTypeOf("number");
    const done = store.updateStep("id-1", "1", "done");
    expect(done.steps[0].endedAt).toBeTypeOf("number");
  });

  it("updates a nested substep by id", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    store.setProgress("id-1", [
      { id: "p", name: "parent", status: "active", substeps: [
        { id: "c", name: "child", status: "pending" },
      ] },
    ]);
    const s = store.updateStep("id-1", "c", "done");
    expect(s.steps[0].substeps![0].status).toBe("done");
  });

  it("emits remove on disconnect", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    const events: unknown[] = [];
    store.on("event", (e) => events.push(e));
    store.disconnect("id-1");
    expect(events).toContainEqual({ type: "remove", sessionId: "id-1" });
    expect(store.getAll()).toHaveLength(0);
  });

  it("throws on unknown session and unknown step", () => {
    const store = new SessionStore();
    expect(() => store.setMarkdown("nope", "x")).toThrow();
    store.register("id-1", "a");
    expect(() => store.updateStep("id-1", "ghost", "done")).toThrow();
  });
});
