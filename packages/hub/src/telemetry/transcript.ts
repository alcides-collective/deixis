import { readFile, stat } from "node:fs/promises";
import type { TokenUsage } from "@deixis/shared";

export interface TranscriptSummary {
  usage: TokenUsage;
  model?: string;
  lastMessage?: string;
  hasError: boolean;
}

interface Row {
  type?: string;
  uuid?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
  };
}

function textOf(row: Row): string | undefined {
  const block = row.message?.content?.find((c) => c.type === "text" && c.text);
  return block?.text?.trim();
}

export function parseTranscript(lines: string[]): TranscriptSummary {
  const byId = new Map<string, TokenUsage>();
  let model: string | undefined;
  let lastMessage: string | undefined;
  let hasError = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      continue;
    }
    if (row.type !== "assistant" || !row.message?.usage) continue;

    model = row.message.model ?? model;
    const text = textOf(row);
    if (text) lastMessage = text;
    if (row.message.stop_reason === "error") hasError = true;

    const u = row.message.usage;
    const cur: TokenUsage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheCreate: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    const id = row.message.id ?? row.uuid ?? `${byId.size}`;
    const prev = byId.get(id);
    if (!prev || cur.output > prev.output) byId.set(id, cur);
  }

  const usage: TokenUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  for (const v of byId.values()) {
    usage.input += v.input;
    usage.output += v.output;
    usage.cacheCreate += v.cacheCreate;
    usage.cacheRead += v.cacheRead;
  }
  return { usage, model, lastMessage, hasError };
}

// Cache by path -> {mtimeMs, summary} so repeated reads of an unchanged file are cheap.
const cache = new Map<string, { mtimeMs: number; summary: TranscriptSummary }>();

export async function readTranscript(path: string): Promise<TranscriptSummary> {
  const { mtimeMs } = await stat(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.summary;
  const text = await readFile(path, "utf8");
  const summary = parseTranscript(text.split("\n"));
  cache.set(path, { mtimeMs, summary });
  return summary;
}
