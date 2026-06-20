import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDocument } from "../src/document.js";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("loadDocument", () => {
  it("reads a file relative to cwd; title is the basename", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-doc-"));
    writeFileSync(join(dir, "spec.md"), "# Spec\n\nbody");
    const d = loadDocument("spec.md", dir);
    expect(d).toEqual({ path: "spec.md", title: "spec.md", markdown: "# Spec\n\nbody" });
  });

  it("truncates content over the size cap", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-doc-"));
    writeFileSync(join(dir, "big.md"), "x".repeat(300 * 1024));
    const d = loadDocument("big.md", dir);
    expect(d.markdown.length).toBeLessThan(300 * 1024);
    expect(d.markdown).toContain("truncated");
  });

  it("throws on a missing file", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-doc-"));
    expect(() => loadDocument("nope.md", dir)).toThrow();
  });
});
