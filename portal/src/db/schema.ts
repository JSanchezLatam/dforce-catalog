/**
 * Portal database (Neon in production). Holds only sha256(token) hashes and
 * the whitelisted snapshot the workshop pushes — never a raw token.
 */
import { bigint, bigserial, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

export const portalTermsAcceptance = pgTable("portal_terms_acceptance", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tokenHash: text("token_hash").notNull(),
  termsVersion: text("terms_version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});
