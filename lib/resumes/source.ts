import { createHash } from "node:crypto";
import { z } from "zod";

// Reserved application metadata, never part of the model's analysis result.
export const RESUME_SOURCE_KEY = "_careermind_resume_source";
export const SOURCE_RECOVERY_MESSAGE = "The original resume evidence for this analysis is unavailable or has changed. Create a new analysis using the intended resume, then investigate its gaps. Your saved results have been kept.";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), kind: z.literal("stored"), resume_id: z.string().min(1), sha256: digest }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("text"), text: z.string().max(60000).refine(s => s.trim().length > 0), sha256: digest }).strict(),
]);
export type ResumeSource = z.infer<typeof sourceSchema>;
export class ResumeSourceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function sourceError() { return new ResumeSourceError(409, SOURCE_RECOVERY_MESSAGE); }
export function textDigest(text: string) { return createHash("sha256").update(text, "utf8").digest("hex"); }
export function textSource(text: string): ResumeSource {
  return validateSource({ version: 1, kind: "text", text, sha256: textDigest(text) }, null);
}
export async function storedSource(resumeId: string, file: File): Promise<ResumeSource> {
  if (file.size > 5 * 1024 * 1024) throw new ResumeSourceError(413, "Resume file exceeds the 5 MiB AI limit");
  return { version: 1, kind: "stored", resume_id: resumeId, sha256: createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex") };
}
function validateSource(value: unknown, resumeId: string | null): ResumeSource {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) throw sourceError();
  const s = parsed.data;
  if (s.kind === "stored" ? s.resume_id !== resumeId : resumeId !== null || textDigest(s.text) !== s.sha256) throw sourceError();
  return s;
}
export function analysisSource(raw: unknown, resumeId: string | null): ResumeSource {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw sourceError();
  return validateSource((raw as Record<string, unknown>)[RESUME_SOURCE_KEY], resumeId);
}
export async function verifyStoredSource(source: ResumeSource, file: File) {
  if (source.kind !== "stored" || (await storedSource(source.resume_id, file)).sha256 !== source.sha256) throw sourceError();
}
// Existing saved sessions without this new metadata remain readable/usable.
// New metadata must never conflict with the frozen file reference.
export function frozenResumeText(context: { resume?: { id?: string | null; source?: ResumeSource } }, fileId: string | null): string | undefined {
  const resume = context.resume;
  if (!resume || !Object.hasOwn(resume, "source")) return undefined;
  const source = validateSource(resume.source, resume.id ?? null);
  if (source.kind === "stored") { if (!fileId) throw sourceError(); return undefined; }
  if (fileId) throw sourceError();
  return source.text;
}
export function publicAnalysisJson<T>(raw: T): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const result = { ...raw } as Record<string, unknown>;
  delete result[RESUME_SOURCE_KEY];
  return result as T;
}
export function publicInvestigationBundle<T extends { investigation: { context_snapshot?: unknown } }>(bundle: T): T {
  const context = bundle.investigation.context_snapshot;
  if (!context || typeof context !== "object" || Array.isArray(context)) return bundle;
  const c = context as Record<string, unknown>;
  const resume = c.resume;
  if (!resume || typeof resume !== "object" || Array.isArray(resume)) return bundle;
  const safeResume = { ...resume } as Record<string, unknown>;
  delete safeResume.source;
  return { ...bundle, investigation: { ...bundle.investigation, context_snapshot: { ...c, resume: safeResume } } };
}
