/**
 * Minimal structured logger for the signaling server (Phase 8.3).
 *
 * Human-readable lines by default; JSON lines with LOG_FORMAT=json for
 * ingestion. W3C-style trace ids (`trace` field) correlate room-session
 * events without an OpenTelemetry SDK (see BACKEND_ROADMAP 8.3).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL = ((): LogLevel => {
  const v = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
})();

const JSON_MODE = (process.env.LOG_FORMAT ?? "text").toLowerCase() === "json";

/** random 128-bit hex trace id (W3C trace-id shape) */
export function newTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[LEVEL]) return;
  if (JSON_MODE) {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
    if (level === "error") console.error(line);
    else console.log(line);
  } else {
    const extra = fields
      ? ` ${Object.entries(fields)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" ")}`
      : "";
    const line = `[aura] ${msg}${extra}`;
    if (level === "error") console.error(line);
    else console.log(line);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
