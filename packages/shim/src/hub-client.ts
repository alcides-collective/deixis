import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3000";
export const sessionId = randomUUID();
export const label = basename(process.cwd()) || "session";

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
