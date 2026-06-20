import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { readdirSync, statSync, readFileSync } from "node:fs";

export const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3939";
export const label = basename(process.cwd()) || "session";

export function resolveSessionId(
  projectsDir: string,
  cwd: string,
  fallback: () => string,
): string {
  try {
    const encoded = cwd.replace(/\//g, "-");
    const dir = join(projectsDir, encoded);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { f } of files) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        const id = (JSON.parse(line) as { sessionId?: string }).sessionId;
        if (id) return id;
      }
    }
  } catch {
    /* fall through */
  }
  return fallback();
}

const projectsDir = join(process.env.HOME ?? "", ".claude", "projects");
export const sessionId = resolveSessionId(projectsDir, process.cwd(), () => randomUUID());

export async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${HUB_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return `Deixis hub error ${res.status}`;
    return null;
  } catch {
    return `Deixis canvas not running on ${HUB_URL} (start it with \`deixis\`)`;
  }
}
