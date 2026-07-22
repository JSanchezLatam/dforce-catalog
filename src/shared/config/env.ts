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
  /** Interfuerza API base URL — e.g. https://api.interfuerza.example. */
  IFX_BASE_URL: optional("IFX_BASE_URL"),
  NODE_ENV: optional("NODE_ENV", "development"),
  /**
   * Cloudflare R2 (S3-compatible) — design.md's "Technical Approach": PDFs
   * live in R2 only, never on local disk (NFR-6). `R2_ENDPOINT` is the
   * account's S3-compatible endpoint (e.g.
   * https://<account-id>.r2.cloudflarestorage.com). Server-only, same
   * secrecy bar as IFX_TOKEN — see catalog-storage/r2.ts.
   */
  R2_ENDPOINT: optional("R2_ENDPOINT"),
  R2_ACCESS_KEY_ID: optional("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: optional("R2_SECRET_ACCESS_KEY"),
  R2_BUCKET: optional("R2_BUCKET"),
  /**
   * Optional display-only base URL (e.g. a custom domain) used to build the
   * `r2Url` stored on each catalog row. Never used to serve downloads
   * directly — actual reads always proxy through
   * /api/catalogs/[id]/file so ownership + upload_status can be checked
   * first (R11.1 — bucket is private, not public).
   */
  R2_PUBLIC_URL: optional("R2_PUBLIC_URL"),
} as const;

/** Keys that must never be included in logs, error messages, or responses. */
export const SENSITIVE_ENV_KEYS = [
  "IFX_TOKEN",
  "DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;
