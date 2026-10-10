// Minimal .env.local loader so the eval harness picks up OPENAI_API_KEY
// without adding a dotenv dependency. Called once from run.ts before
// any OpenAI SDK import that reads the env.
//
// Format tolerated: KEY=VALUE, KEY="VALUE", KEY='VALUE'. Blank lines
// and lines beginning with # are ignored. No multi-line / interpolation.

import fs from "node:fs";
import path from "node:path";

export function loadDotEnvLocal(cwd: string = process.cwd()): void {
  const file = path.join(cwd, ".env.local");
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith(`"`) && value.endsWith(`"`)) ||
      (value.startsWith(`'`) && value.endsWith(`'`))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
