import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const MAX_CHARS = 256 * 1024;

export function loadDocument(
  path: string,
  cwd: string,
): { path: string; title: string; markdown: string } {
  const abs = resolve(cwd, path);
  let markdown = readFileSync(abs, "utf8");
  if (markdown.length > MAX_CHARS) {
    markdown = markdown.slice(0, MAX_CHARS) + "\n\n*…truncated (file exceeds 256 KB)*";
  }
  return { path, title: basename(abs), markdown };
}
