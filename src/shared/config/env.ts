/**
 * Central place to read process.env.
 *
 * Per NFR-4, `IFX_TOKEN` (the Interfuerza API token) MUST be a server-only
 * environment variable — it must never appear in logs, HTTP responses, or
 * versioned files. This module intentionally never logs the values it reads,
 * and callers must not either (see `SENSITIVE_ENV_KEYS` below).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export const env = {
  /** Postgres connection string shared by Drizzle, Drizzle Kit, and pg-boss. */
  DATABASE_URL: required("DATABASE_URL"),
  /** Interfuerza API token — server-only, never log or expose (NFR-4). */
  IFX_TOKEN: optional("IFX_TOKEN"),
  NODE_ENV: optional("NODE_ENV", "development"),
} as const;

/** Keys that must never be included in logs, error messages, or responses. */
export const SENSITIVE_ENV_KEYS = ["IFX_TOKEN", "DATABASE_URL"] as const;
