import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "jsonc-parser";

describe("wrangler.jsonc config guard", () => {
  const raw = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
  const config = parse(raw) as Record<string, unknown>;

  it("main points at the custom worker entry", () => {
    expect(config.main).toBe("src/worker.ts");
  });

  it("declares at least one cron trigger", () => {
    const triggers = config.triggers as { crons?: unknown[] } | undefined;
    expect(Array.isArray(triggers?.crons) && triggers.crons.length > 0).toBe(true);
  });
});
