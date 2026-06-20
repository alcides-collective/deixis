import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { readdirSync, statSync, readFileSync } from "node:fs";

export const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3939";
export const label = basename(process.cwd()) || "session";

export function resolveSessionId(
  env: Record<string, string | undefined>,
  projectsDir: string,
  cwd: string,
  fallback: () => string,
): string {
  // Claude Code sets CLAUDE_CODE_SESSION_ID in the env of processes it spawns.
  // It is the authoritative id — immune to the newest-transcript race that bit
  // us when a project folder has hosted more than one session.
  const fromEnv = env.CLAUDE_CODE_SESSION_ID;
  if (fromEnv) return fromEnv;
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

let cachedId: string | undefined;
// Resolved lazily so that, when the env var is absent and we fall back to the
// transcript, resolution happens at first use — by which point the current
// session's transcript is the freshest file in the project dir.
export function getSessionId(): string {
  if (cachedId === undefined) {
    const projectsDir = join(process.env.HOME ?? "", ".claude", "projects");
    cachedId = resolveSessionId(process.env, projectsDir, process.cwd(), () => randomUUID());
  }
  return cachedId;
}

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
