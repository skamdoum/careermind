// Test-only Node preload. Never imported by application code or build scripts.
import { appendFileSync } from "node:fs";

const project = process.env.CAREERMIND_COMPARE_TEST_PROJECT_REF;
const audit = process.env.CAREERMIND_COMPARE_AUDIT_FILE;
if (!project || !/^[a-z0-9]+$/.test(project) || !audit) {
  throw new Error("Compare rejection test requires explicit project and audit-file settings");
}
const host = `${project}.supabase.co`;
const originalFetch = globalThis.fetch;
function record(event, method) {
  // Never record URLs, bodies, credentials, cookies, or personal data.
  appendFileSync(audit, `${JSON.stringify({ event, method, pid: process.pid })}\n`, { mode: 0o600 });
}
record("guard-loaded", "");
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.hostname === host && (
    (url.pathname.startsWith("/auth/v1/") && ["GET", "POST"].includes(method)) ||
    // Fixture setup uses the existing profile/resume APIs too. Permit their
    // database traffic, while all Storage/provider calls stay forbidden here.
    (url.pathname.startsWith("/rest/v1/") && ["GET", "POST", "PATCH", "DELETE"].includes(method))
  )) {
    record("allowed-auth-or-db", method);
    return originalFetch(input, init);
  }
  const event = url.hostname === "api.openai.com" ? "blocked-openai" :
    url.hostname === host && url.pathname.startsWith("/storage/v1/") ? "blocked-storage" : "blocked-unexpected";
  record(event, method);
  throw new Error("Compare live rejection test blocked unexpected outbound work");
};
