import "server-only";

export class ResumeAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Metadata can be written by clients. Validate the object reference independently
// of row ownership; never decode or normalize an ambiguous path into permission.
export function assertOwnedResumePath(path: unknown, userId: string): asserts path is string {
  const segments = typeof path === "string" ? path.split("/") : [];
  if (!userId || segments.length < 2 || segments[0] !== userId ||
    segments.some(part => !part || part === "." || part === ".." || /[%?#\\\x00-\x1f\x7f]/.test(part))) {
    throw new ResumeAccessError(403, "Resume storage reference is not authorized");
  }
}
