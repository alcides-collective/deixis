import { describe, it, expect } from "vitest";
import request from "supertest";
import { SessionStore } from "../src/store.js";
import { createApp } from "../src/server.js";
import { Telemetry } from "../src/telemetry/index.js";
import { PricingTable } from "../src/telemetry/pricing.js";
import { StatusEngine } from "../src/telemetry/status.js";

function app() {
  return createApp(new SessionStore());
}

describe("hub routes", () => {
  it("registers a session", async () => {
    const a = app();
    await request(a).post("/session/id-1/register").send({ label: "x" }).expect(200);
  });

  it("404s markdown for unknown session", async () => {
    await request(app()).post("/session/ghost/markdown").send({ markdown: "y" }).expect(404);
  });

  it("accepts markdown for a registered session", async () => {
    const a = app();
    await request(a).post("/session/id-1/register").send({ label: "x" });
    await request(a).post("/session/id-1/markdown").send({ markdown: "# hi" }).expect(200);
  });

  it("streams a snapshot on /events", async () => {
    const a = app();
    await request(a).post("/session/id-1/register").send({ label: "x" });
    const res = await request(a)
      .get("/events")
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.on("data", (c) => {
          data += c;
          if (data.includes("snapshot")) r.destroy();
        });
        r.on("close", () => cb(null, data));
      });
    expect(res.body).toContain("snapshot");
    expect(res.body).toContain("id-1");
  });
});

describe("telemetry route", () => {
  it("accepts an event and sets session status", async () => {
    const store = new SessionStore();
    const tel = new Telemetry(store, new PricingTable(), new StatusEngine());
    const a = createApp(store, tel);
    await request(a)
      .post("/telemetry/cc-1/event")
      .send({ event: "PreToolUse", toolName: "Bash" })
      .expect(200);
    const s = store.getAll().find((x) => x.sessionId === "cc-1");
    expect(s?.telemetry?.status).toBe("working");
    expect(s?.telemetry?.currentTool).toBe("Bash");
  });
});
