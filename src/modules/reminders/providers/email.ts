/**
 * reminders/providers/email.ts — Resend SDK wrapper (ADR-4). Sends reminder
 * emails in-process via the `resend` Node npm SDK (`new
 * Resend(apiKey).emails.send(...)`), NOT the `resend-cli` skill/CLI — that
 * tool is terminal/CI-only; the reminder worker runs inside the Node server
 * process (pg-boss `boss.work`), so shelling out per reminder would add a
 * process boundary for zero benefit (design.md ADR-4).
 *
 * Graceful degradation: this app must boot and the reminder worker must run
 * fine with zero Resend credentials configured. If `RESEND_API_KEY`/
 * `RESEND_FROM` are missing, `sendEmail` returns `{ ok: false, reason }`
 * instead of throwing — no client is even constructed. Real Resend SDK
 * errors (e.g. invalid `from` address) are likewise reported as `{ ok: false,
 * reason }`, never thrown — callers (reminders/job.ts's dispatch wiring)
 * decide whether a `{ ok: false }` result should become a throw (so
 * pg-boss retries) or a terminal `failed`/`skipped` status.
 */
import { Resend } from "resend";

import { env } from "@/shared/config/env";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export type SendEmailResult = { ok: true } | { ok: false; reason: string };

/** Minimal shape this module actually calls on the Resend SDK — DI seam for tests (no real network calls). */
export type ResendLike = {
  emails: {
    send: (payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export type SendEmailDeps = {
  /** Override for `env.RESEND_API_KEY` — pass `""` in tests to force the not-configured path deterministically, regardless of the ambient shell env. */
  apiKey?: string;
  /** Override for `env.RESEND_FROM`. */
  from?: string;
  /** Override the real Resend client (tests inject a fake — no real network calls). */
  client?: ResendLike;
};

/** ADR-4 — sends one reminder email. Never throws; always resolves to a result. */
export async function sendEmail(input: SendEmailInput, deps: SendEmailDeps = {}): Promise<SendEmailResult> {
  const apiKey = deps.apiKey ?? env.RESEND_API_KEY;
  const from = deps.from ?? env.RESEND_FROM;

  if (!apiKey || !from) {
    return { ok: false, reason: "RESEND_API_KEY/RESEND_FROM not configured" };
  }

  const client = deps.client ?? (new Resend(apiKey) as unknown as ResendLike);

  const { error } = await client.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });

  if (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}
