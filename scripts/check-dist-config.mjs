#!/usr/bin/env node
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
if (!Array.isArray(config.triggers?.crons) || config.triggers.crons.length === 0) {
  console.error("FAIL: dist/server/wrangler.json is missing triggers.crons — adapter may have dropped the cron");
  process.exit(1);
}
console.log("OK: dist/server/wrangler.json carries triggers.crons:", config.triggers.crons);
