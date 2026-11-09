/**
 * Portal database (Neon in production). Holds only sha256(token) hashes and
 * the whitelisted snapshot the workshop pushes — never a raw token.
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { PortalVehicle } from "../contract";

export const portalCustomer = pgTable("portal_customer", {
  clienteId: text("cliente_id").primaryKey(),
  /** NULL = no valid link (revoked, or the customer was removed). */
  tokenHash: text("token_hash").unique(),
  snapshot: jsonb("snapshot").$type<{ vehicles: PortalVehicle[]; generatedAt: string }>(),
  // Workshop versions are small integers: the wire carries a JS number.
  version: bigint("version", { mode: "number" }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portalTermsAcceptance = pgTable(
  "portal_terms_acceptance",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tokenHash: text("token_hash").notNull(),
    termsVersion: text("terms_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // What makes two concurrent accepts one row: `where not exists` alone races.
  (t) => [uniqueIndex("portal_terms_acceptance_token_version_uq").on(t.tokenHash, t.termsVersion)],
);

/** Workshop feedback. The portal alone stamps `received_at`, `status` and `internal_note`. */
export const supportFeedback = pgTable(
  "support_feedback",
  {
    id: uuid("id").primaryKey(),
    username: text("username").notNull(),
    role: text("role").notNull(),
    category: text("category").notNull(),
    text: text("text").notNull(),
    route: text("route").notNull(),
    screenLabel: text("screen_label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("nuevo"),
    internalNote: text("internal_note").notNull().default(""),
  },
  (t) => [
    check("support_feedback_status_check", sql`${t.status} in ('nuevo', 'leido', 'resuelto')`),
    index("support_feedback_created_at_idx").on(t.createdAt.desc()),
  ],
);

/** Inbox login throttle, one row per client ip. */
export const supportLoginThrottle = pgTable("support_login_throttle", {
  ip: text("ip").primaryKey(),
  failures: integer("failures").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
