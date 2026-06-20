import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { SessionStore } from "./store.js";
import { createApp } from "./server.js";

const port = Number(process.env.DEIXIS_PORT ?? 3939);
const store = new SessionStore();
const app = createApp(store);

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
