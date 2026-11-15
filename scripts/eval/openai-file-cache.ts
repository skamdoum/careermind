import { activePilot } from "./pilot-guard";
// Pre-upload resume fixtures to OpenAI once; cache file_ids keyed by
// SHA-256 of the file content so re-authoring a resume changes the key
// and triggers a fresh upload. The cache file lives next to the eval
// scripts and is gitignored.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import OpenAI from "openai";

const CACHE_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  ".openai-file-ids.json"
);

type CacheEntry = { file_id: string; uploaded_at: string; source_path: string };
type Cache = Record<string, CacheEntry>;

function readCache(): Cache {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw) as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function uploadOrReuseResume(args: {
  localPath: string;
  mimeType: string;
}): Promise<{ file_id: string; sha256: string; cached: boolean }> {
  const absPath = path.resolve(args.localPath);
  const content = fs.readFileSync(absPath);
  const hash = sha256(content);

  const cache = readCache();
  if (cache[hash] && !activePilot) {
    return { file_id: cache[hash].file_id, sha256: hash, cached: true };
  }

  const blob = new Blob([new Uint8Array(content)], { type: args.mimeType });
  // Evaluation uploads bypass application accounting without touching production.
  const openai = new OpenAI({ maxRetries: 0, timeout: 60000 });
  const { id: file_id } = await openai.files.create({
    file: new File([blob], path.basename(absPath), { type: args.mimeType }), purpose: "user_data",
  });

  cache[hash] = {
    file_id,
    uploaded_at: new Date().toISOString(),
    source_path: absPath,
  };
  if (!activePilot) writeCache(cache);

  return { file_id, sha256: hash, cached: false };
}
