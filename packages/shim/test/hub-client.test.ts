import { describe, it, expect, vi, afterEach } from "vitest";
import { post } from "../src/hub-client.js";

afterEach(() => vi.restoreAllMocks());

describe("post", () => {
  it("returns null on ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await post("/x", {})).toBeNull();
  });

  it("returns a friendly message when the hub is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const msg = await post("/x", {});
    expect(msg).toMatch(/not running/i);
  });

  it("returns an error string on non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await post("/x", {})).toMatch(/404/);
  });
});
