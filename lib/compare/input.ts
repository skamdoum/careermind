export const COMPARE_LIMITS = {
  bodyBytes: 512 * 1024,
  resumeCharacters: 60_000,
  jobCharacters: 30_000,
  jobs: 3,
} as const;

export class CompareError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function readCompareInput(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new CompareError(415, "Expected application/json");
  }
  // Enforce actual bytes, including chunked requests; Content-Length is not trusted.
  if (!req.body) throw new CompareError(400, "Missing input");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > COMPARE_LIMITS.bodyBytes) {
        void reader.cancel().catch(() => {});
        throw new CompareError(413, "Comparison request is too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CompareError) throw error;
    throw new CompareError(400, "Could not read comparison request");
  } finally { reader.releaseLock(); }

  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new CompareError(400, "Invalid JSON"); }
  if (!object(body)) throw new CompareError(400, "Expected a comparison object");

  const { resumeText, resume_id: resumeId, latestResume, jobDescriptions } = body;
  if (!Array.isArray(jobDescriptions) || jobDescriptions.length < 1 || jobDescriptions.length > COMPARE_LIMITS.jobs) {
    throw new CompareError(400, "Provide one to three job descriptions");
  }
  const jobs: string[] = [];
  for (const job of jobDescriptions) {
    if (typeof job !== "string" || !job.trim()) throw new CompareError(400, "Job descriptions must be nonempty strings");
    if (job.length > COMPARE_LIMITS.jobCharacters) throw new CompareError(413, "Job description is too large");
    jobs.push(job);
  }
  if (resumeText !== undefined && typeof resumeText !== "string") throw new CompareError(400, "Invalid resume text");
  if (typeof resumeText === "string" && resumeText.length > COMPARE_LIMITS.resumeCharacters) {
    throw new CompareError(413, "Resume text is too large");
  }
  if (latestResume != null && !object(latestResume)) throw new CompareError(400, "Invalid resume reference");
  const legacyId = object(latestResume) ? latestResume.id : undefined;
  if ((resumeId !== undefined && !uuid(resumeId)) || (legacyId !== undefined && !uuid(legacyId))) {
    throw new CompareError(400, "Invalid resume ID");
  }
  if (resumeId !== undefined && legacyId !== undefined && resumeId !== legacyId) {
    throw new CompareError(400, "Conflicting resume IDs");
  }
  const id = (resumeId ?? legacyId) as string | undefined;
  if (!id && latestResume != null) throw new CompareError(400, "A saved resume requires a resume ID");
  if (!id && !resumeText?.trim()) throw new CompareError(400, "Missing resume");
  return { resumeId: id, resumeText, jobDescriptions: jobs };
}
