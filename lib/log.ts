// Structured JSON logger. Emits one line per event — Vercel's log
// pipeline parses JSON out of stdout automatically. Keep fields
// privacy-safe: no resume text, no job descriptions, no AI narratives,
// no raw user messages, no email bodies.

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = {
  level: LogLevel;
  event: string;
  [key: string]: unknown;
};

function emit(level: LogLevel, event: string, fields: Record<string, unknown>): void {
  const line: LogFields = {
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  const payload = JSON.stringify(line);
  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) =>
    emit("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) =>
    emit("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) =>
    emit("error", event, fields),
  debug: (event: string, fields: Record<string, unknown> = {}) => {
    if (process.env.NODE_ENV !== "production") emit("debug", event, fields);
  },
};
