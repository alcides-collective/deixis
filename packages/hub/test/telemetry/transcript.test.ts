import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript, readTranscript } from "../../src/telemetry/transcript.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "transcript.jsonl");

describe("parseTranscript", () => {
  it("dedups usage by message id keeping max output, sums across ids", () => {
    const lines = readFileSync(fixture, "utf8").trim().split("\n");
    const s = parseTranscript(lines);
    // m1 -> max output row (input100, output40, cc5, cr200); m2 -> (50,20,0,0)
    expect(s.usage).toEqual({ input: 150, output: 60, cacheCreate: 5, cacheRead: 200 });
    expect(s.model).toBe("claude-opus-4-8");
    expect(s.lastMessage).toBe("final answer");
    expect(s.hasError).toBe(false);
  });

  it("reads from a file path", async () => {
    const s = await readTranscript(fixture);
    expect(s.usage.output).toBe(60);
  });

  it("flags hasError on an error stop_reason", () => {
    const s = parseTranscript([
      '{"type":"assistant","message":{"id":"e1","model":"x","usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"oops"}],"stop_reason":"error"}}',
    ]);
    expect(s.hasError).toBe(true);
  });
});
