import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { SessionStore } from "./store.js";
import { createApp } from "./server.js";
import { PricingTable, refreshPricing } from "./telemetry/pricing.js";
import { StatusEngine } from "./telemetry/status.js";
import { Telemetry } from "./telemetry/index.js";
import { sweepFinished } from "./telemetry/sweep.js";

const port = Number(process.env.DEIXIS_PORT ?? 3939);
const store = new SessionStore();
const table = new PricingTable();
const engine = new StatusEngine();
const telemetry = new Telemetry(store, table, engine);
const app = createApp(store, telemetry);

const pricingCache = join(process.env.HOME ?? "", ".claude", "deixis", "pricing.json");
void refreshPricing(table, pricingCache);
setInterval(() => void refreshPricing(table, pricingCache), 24 * 60 * 60 * 1000).unref();
setInterval(() => telemetry.tick(Date.now()), 10_000).unref();
setInterval(() => sweepFinished(store), 15_000).unref();

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, "..", "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/(session|events)).*/, (_req, res) =>
    res.sendFile(join(webDist, "index.html")),
  );
}

app.listen(port, () => {
  console.log(`Deixis hub listening on http://localhost:${port}`);
});
