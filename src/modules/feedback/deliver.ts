/**
 * feedback/deliver.ts — the outbox delivery to the support portal (in-app-feedback
 * WU4, design §3). Contract: NEVER throws, so the send route always answers.
 * Nothing sent to Sentry or stored in `last_error` carries the comment text or
 * the secret: only the failure class, the status and the attempt number.
 */
import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { IngestBody } from "@portal/contract";

import { PortalRejectedError, PortalServerError, sendToPortal } from "@/modules/portal-sync/transport";
import { env } from "@/shared/config/env";
import { db } from "@/shared/db/client";
import { feedback } from "@/shared/db/schema";
import type { FeedbackRow } from "./service";

export const FEEDBACK_DELIVER_JOB = "feedback-deliver";
/** The portal's `short()` limit on `username`; the workshop has no cap of its own. */
const PORTAL_USERNAME_MAX = 200;
const LEASE_MINUTES = 2;
const BACKOFF_CAP_MINUTES = 60;

/** 1, 2, 4 ... capped at 1 h, for every failure class: a 4xx is not permanent. */
export const backoffMinutes = (attempt: number): number => Math.min(2 ** (attempt - 1), BACKOFF_CAP_MINUTES);

type Failure = { lastError: string; delayMinutes: number };

export type DeliverDeps = {
  config?: { url?: string; secret?: string };
  claim?: (id: string) => Promise<FeedbackRow | null>;
  markDelivered?: (id: string) => Promise<void>;
  markFailed?: (id: string, failure: Failure) => Promise<void>;
  report?: (error: Error, context: { level: "error" | "warning"; tags: Record<string, string> }) => void;
  fetch?: typeof fetch;
};

/** The lease: a claimed row is not due again for 2 minutes, so a crashed delivery or an overlap cannot double-send. */
export const claimFeedback = async (id: string): Promise<FeedbackRow | null> => {
  const [row] = await db
    .update(feedback)
    .set({ attempts: sql`${feedback.attempts} + 1`, nextAttemptAt: sql`now() + make_interval(mins => ${LEASE_MINUTES})` })
    .where(and(eq(feedback.id, id), isNull(feedback.deliveredAt), lte(feedback.nextAttemptAt, sql`now()`)))
    .returning();
  return row ?? null;
};

export const markFeedbackDelivered = async (id: string): Promise<void> => {
  await db
    .update(feedback)
    .set({ deliveredAt: sql`now()`, lastError: null })
    .where(and(eq(feedback.id, id), isNull(feedback.deliveredAt)));
};

export const markFeedbackFailed = async (id: string, f: Failure): Promise<void> => {
  await db
    .update(feedback)
    .set({ lastError: f.lastError, nextAttemptAt: sql`now() + make_interval(mins => ${f.delayMinutes})` })
    .where(and(eq(feedback.id, id), isNull(feedback.deliveredAt)));
};

function classify(error: unknown): { failure: "4xx" | "5xx" | "rejected" | "timeout" | "network"; status?: number } {
  if (error instanceof PortalRejectedError) return error.status === undefined ? { failure: "rejected" } : { failure: "4xx", status: error.status };
  if (error instanceof PortalServerError) return { failure: "5xx", status: error.status };
  if (error instanceof Error && error.name === "TimeoutError") return { failure: "timeout" };
  return { failure: "network" };
}

function toBody(row: FeedbackRow): IngestBody {
  return {
    kind: "feedback",
    id: row.id,
    username: row.username.slice(0, PORTAL_USERNAME_MAX),
    role: row.role as "tecnico" | "jefe_taller" | "administrador", // `pantalla` cannot send: policy `feedback.send` refuses it
    category: row.category,
    text: row.text,
    route: row.route,
    screenLabel: row.screenLabel,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deliverFeedback(id: string, timeoutMs: number, deps: DeliverDeps = {}): Promise<"delivered" | "queued"> {
  const report = (error: Error, context: { level: "error" | "warning"; tags: Record<string, string> }) => {
    try {
      (deps.report ?? Sentry.captureException)(error, context);
    } catch {
      // Reporting is best effort: the row is already safe.
    }
  };
  try {
    const config = deps.config ?? { url: env.PORTAL_INGEST_URL, secret: env.PORTAL_INGEST_SECRET };
    if (!config.url || !config.secret) return "queued"; // waits untouched until the env is set
    const row = await (deps.claim ?? claimFeedback)(id);
    if (!row) return "queued";
    try {
      await sendToPortal(toBody(row), { url: config.url, secret: config.secret }, deps.fetch, timeoutMs);
    } catch (error) {
      const { failure, status } = classify(error);
      const lastError = status === undefined ? failure : `${failure} ${status}`;
      // A fresh Error: the original's message can carry whatever the network layer put in it.
      report(new Error(`feedback-deliver failed: ${lastError}`), {
        level: failure === "timeout" || failure === "network" ? "warning" : "error",
        tags: { job: FEEDBACK_DELIVER_JOB, feedbackId: id, failure, ...(status === undefined ? {} : { status: String(status) }), attempt: String(row.attempts) },
      });
      await (deps.markFailed ?? markFeedbackFailed)(id, { lastError, delayMinutes: backoffMinutes(row.attempts) });
      return "queued";
    }
    await (deps.markDelivered ?? markFeedbackDelivered)(id);
    return "delivered";
  } catch (error) {
    report(new Error(`feedback-deliver crashed: ${error instanceof Error ? error.name : "unknown"}`), {
      level: "error",
      tags: { job: FEEDBACK_DELIVER_JOB, feedbackId: id },
    });
    return "queued";
  }
}
