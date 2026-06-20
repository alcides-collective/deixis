import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSessionId } from "../src/hub-client.js";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("resolveSessionId", () => {
  it("reads sessionId from the newest transcript under the encoded cwd", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-id-"));
    const projects = join(dir, "projects");
    const encoded = join(projects, "-tmp-proj");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(join(encoded, "a.jsonl"), JSON.stringify({ sessionId: "real-cc-id" }) + "\n");
    expect(resolveSessionId(projects, "/tmp/proj", () => "fallback")).toBe("real-cc-id");
  });

  it("uses the fallback when no transcript exists", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-id-"));
    expect(resolveSessionId(join(dir, "projects"), "/tmp/none", () => "fallback")).toBe("fallback");
  });
});
