import { describe, it, expect } from "vitest";
import { PricingTable, computeCost } from "../../src/telemetry/pricing.js";

describe("PricingTable", () => {
  it("falls back to family pricing from the snapshot", () => {
    const t = new PricingTable();
    expect(t.priceFor("claude-opus-4-8")).toEqual({ input: 0.000015, output: 0.000075 });
    expect(t.priceFor("claude-3-5-sonnet-20241022")).toEqual({ input: 0.000003, output: 0.000015 });
    expect(t.priceFor("claude-haiku-4-5")).toEqual({ input: 0.0000008, output: 0.000004 });
  });

  it("returns null for unknown models", () => {
    expect(new PricingTable().priceFor("gpt-4o")).toBeNull();
  });

  it("prefers exact OpenRouter ids after load()", () => {
    const t = new PricingTable();
    t.load([{ id: "anthropic/claude-opus-4", pricing: { prompt: "0.00002", completion: "0.0001" } }]);
    expect(t.priceFor("anthropic/claude-opus-4")).toEqual({ input: 0.00002, output: 0.0001 });
  });

  it("computeCost applies cache multipliers", () => {
    const price = { input: 0.000003, output: 0.000015 };
    const usage = { input: 1000, output: 500, cacheCreate: 200, cacheRead: 4000 };
    // 1000*3e-6 + 500*15e-6 + 200*3e-6*1.25 + 4000*3e-6*0.1
    expect(computeCost(usage, price)).toBeCloseTo(0.003 + 0.0075 + 0.00075 + 0.0012, 9);
  });

  it("computeCost returns null when price is null", () => {
    expect(computeCost({ input: 1, output: 1, cacheCreate: 0, cacheRead: 0 }, null)).toBeNull();
  });
});
