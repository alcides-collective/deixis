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
