import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TokenUsage } from "@deixis/shared";
import snapshot from "./pricing-snapshot.json" with { type: "json" };

export interface Price { input: number; output: number }
export interface OpenRouterModel { id: string; pricing: { prompt: string; completion: string } }

const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.1;
type Family = "opus" | "sonnet" | "haiku";

export class PricingTable {
  private byId = new Map<string, Price>();
  private families: Record<Family, Price> = { ...(snapshot as Record<Family, Price>) };

  load(models: OpenRouterModel[]): void {
    for (const m of models) {
      if (!m.id.startsWith("anthropic/")) continue;
      const price: Price = {
        input: parseFloat(m.pricing.prompt),
        output: parseFloat(m.pricing.completion),
      };
      if (!Number.isFinite(price.input) || !Number.isFinite(price.output)) continue;
      this.byId.set(m.id.toLowerCase(), price);
      for (const fam of ["opus", "sonnet", "haiku"] as Family[]) {
        if (m.id.includes(fam)) this.families[fam] = price;
      }
    }
  }

  priceFor(model: string): Price | null {
    const norm = model.toLowerCase();
    const exact = this.byId.get(norm) ?? this.byId.get(`anthropic/${norm}`);
    if (exact) return exact;
    if (norm.includes("opus")) return this.families.opus;
    if (norm.includes("sonnet")) return this.families.sonnet;
    if (norm.includes("haiku")) return this.families.haiku;
    return null;
  }
}

export function computeCost(usage: TokenUsage, price: Price | null): number | null {
  if (!price) return null;
  return (
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheCreate * price.input * CACHE_WRITE_MULT +
    usage.cacheRead * price.input * CACHE_READ_MULT
  );
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

export async function refreshPricing(table: PricingTable, cachePath: string): Promise<void> {
  try {
    const res = await fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const body = (await res.json()) as { data: OpenRouterModel[] };
    table.load(body.data);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(body.data));
  } catch {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as OpenRouterModel[];
      table.load(cached);
    } catch {
      /* keep snapshot-only families */
    }
  }
}
