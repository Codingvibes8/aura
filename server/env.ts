/**
 * Minimal .env loader for the standalone signaling server.
 *
 * The signaling process runs outside Next.js, so Next's built-in dotenv
 * handling doesn't apply. This parses KEY=VALUE lines (comments + quotes
 * supported) without adding a dependency. Missing files are fine —
 * environment variables and defaults take over.
 *
 * Precedence: process.env > .env.local > .env
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseEnvFile(path: string, into: Map<string, string>): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!into.has(key)) into.set(key, value);
  }
}

export function loadServerEnv(): void {
  const root = process.cwd();
  const fileValues = new Map<string, string>();
  // .env.local wins over .env — parse lowest priority first
  parseEnvFile(join(root, ".env"), fileValues);
  parseEnvFile(join(root, ".env.local"), fileValues);
  for (const [key, value] of fileValues) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
