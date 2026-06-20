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
