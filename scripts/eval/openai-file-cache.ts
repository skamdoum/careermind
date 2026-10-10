// Pre-upload resume fixtures to OpenAI once; cache file_ids keyed by
// SHA-256 of the file content so re-authoring a resume changes the key
// and triggers a fresh upload. The cache file lives next to the eval
// scripts and is gitignored.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { uploadResumeFileForInvestigation } from "@/lib/gap-investigation/agent";

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
  if (cache[hash]) {
    return { file_id: cache[hash].file_id, sha256: hash, cached: true };
  }

  const blob = new Blob([new Uint8Array(content)], { type: args.mimeType });
  const file_id = await uploadResumeFileForInvestigation({
    blob,
    fileName: path.basename(absPath),
    mimeType: args.mimeType,
  });

  cache[hash] = {
    file_id,
    uploaded_at: new Date().toISOString(),
    source_path: absPath,
  };
  writeCache(cache);

  return { file_id, sha256: hash, cached: false };
}
