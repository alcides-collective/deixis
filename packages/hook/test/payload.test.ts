import { describe, it, expect } from "vitest";
import { buildEvent } from "../src/index.js";

describe("buildEvent", () => {
  it("extracts sessionId and normalizes the body", () => {
    const stdin = JSON.stringify({
      session_id: "cc-1",
      hook_event_name: "PreToolUse",
      cwd: "/x/y",
      transcript_path: "/t.jsonl",
      tool_name: "Bash",
    });
    const out = buildEvent(stdin, ["node", "hook"]);
    expect(out).toEqual({
      sessionId: "cc-1",
      body: { event: "PreToolUse", cwd: "/x/y", transcriptPath: "/t.jsonl", toolName: "Bash" },
    });
  });

  it("falls back to argv for the event name", () => {
    const out = buildEvent(JSON.stringify({ session_id: "cc-1" }), ["node", "hook", "Stop"]);
    expect(out?.body).toMatchObject({ event: "Stop" });
  });

  it("returns null without a session id", () => {
    expect(buildEvent("{}", ["node", "hook"])).toBeNull();
  });
});
