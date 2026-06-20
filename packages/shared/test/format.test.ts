import { describe, it, expect } from "vitest";
import { formatTool } from "../src/index.js";

describe("formatTool", () => {
  it("brands our own MCP tools with ◆ and a humanized name", () => {
    expect(formatTool("mcp__deixis__progress_update")).toBe("◆ Progress Update");
    expect(formatTool("mcp__deixis__render_markdown")).toBe("◆ Render Markdown");
    expect(formatTool("mcp__deixis__progress_set")).toBe("◆ Progress Set");
  });

  it("scopes other MCP tools as server·Humanized", () => {
    expect(formatTool("mcp__todoist__add-tasks")).toBe("todoist·Add Tasks");
  });

  it("leaves built-in tools unchanged", () => {
    expect(formatTool("Bash")).toBe("Bash");
    expect(formatTool("Read")).toBe("Read");
  });

  it("is best-effort on a malformed mcp name", () => {
    expect(formatTool("mcp__weird")).toBe("Weird");
  });
});
