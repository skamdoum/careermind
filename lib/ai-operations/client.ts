const memoryKeys = new Map<string, string>();

// Store only a payload digest and random key, never career content. Session
// storage preserves retries across reloads in the same tab. Success clears it
// so an intentional later analysis starts a new operation.
export async function retryKey(scope: string, payload: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `careermind:retry:${scope}:${hash}`;
  let key: string;
  try {
    key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  } catch {
    key = memoryKeys.get(storageKey) ?? crypto.randomUUID();
    memoryKeys.set(storageKey, key);
  }
  return { key, clear: () => { memoryKeys.delete(storageKey); try { sessionStorage.removeItem(storageKey); } catch { /* Storage disabled. */ } } };
}
