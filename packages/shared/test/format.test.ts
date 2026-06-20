import { describe, it, expect } from "vitest";
import { formatTool } from "../src/index.js";

describe("formatTool", () => {
  it("brands our own MCP tools with ◆ and bare name", () => {
    expect(formatTool("mcp__deixis__progress_set")).toBe("◆ progress_set");
    expect(formatTool("mcp__deixis__render_markdown")).toBe("◆ render_markdown");
  });

  it("scopes other MCP tools as server·tool", () => {
    expect(formatTool("mcp__todoist__add-tasks")).toBe("todoist·add-tasks");
  });

  it("leaves built-in tools unchanged", () => {
    expect(formatTool("Bash")).toBe("Bash");
    expect(formatTool("Read")).toBe("Read");
  });

  it("preserves underscores in the tool segment", () => {
    expect(formatTool("mcp__deixis__progress_update")).toBe("◆ progress_update");
  });

  it("is best-effort on a malformed mcp name", () => {
    expect(formatTool("mcp__weird")).toBe("weird");
  });
});
