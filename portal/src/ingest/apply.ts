/**
 * The only writer of `portal_customer`. Upsert and delete are ONE statement,
 * `INSERT ... ON CONFLICT (cliente_id) DO UPDATE ... WHERE version < excluded`,
 * so the version gate is atomic under concurrent deliveries (the second writer
 * re-checks the WHERE against the committed row). A delete is a tombstone: a
 * hard DELETE would let a delayed older upsert resurrect the customer.
 */
import { and, between, lt, notInArray, sql } from "drizzle-orm";

import type { IngestBody } from "../contract";
import { db } from "../db/client";
import { portalCustomer, supportFeedback, usageCount, usageCoverage, usageScreen } from "../db/schema";

type Snapshot = NonNullable<typeof portalCustomer.$inferInsert.snapshot>;

async function gatedWrite(clienteId: string, version: number, tokenHash: string | null, snapshot: Snapshot | null) {
  const rows = await db
    .insert(portalCustomer)
    .values({ clienteId, version, tokenHash, snapshot })
    .onConflictDoUpdate({
      target: portalCustomer.clienteId,
      set: { version, tokenHash, snapshot, syncedAt: sql`now()` },
      setWhere: sql`${portalCustomer.version} < excluded.version`,
    })
    .returning({ clienteId: portalCustomer.clienteId });
  return { applied: rows.length > 0 };
}

/** Every YYYY-MM-DD from `from` to `to`, inclusive (the parser caps it at 31). */
function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/**
 * Absolute totals: the range is replaced, never added to, so a resend is a
 * no-op. Each day of the range is marked covered, so a day with no counts
 * reads as zero rather than "not arrived". The catalog is replaced whole.
 */
async function applyUsage({ from, to, screens, counts }: Extract<IngestBody, { kind: "usage" }>) {
  await db.transaction(async (tx) => {
    await tx.delete(usageCount).where(between(usageCount.day, from, to));
    if (counts.length > 0) {
      await tx.insert(usageCount).values(counts.map((c) => ({ day: c.day, screen: c.screen, roleGroup: c.group, views: c.views })));
    }
    await tx
      .insert(usageCoverage)
      .values(daysOf(from, to).map((day) => ({ day })))
      .onConflictDoUpdate({ target: usageCoverage.day, set: { receivedAt: sql`now()` } });
    await tx.delete(usageScreen);
    if (screens.length > 0) await tx.insert(usageScreen).values(screens);
  });
  return { applied: true };
}

export async function applyIngest(body: IngestBody): Promise<{ applied: boolean }> {
  switch (body.kind) {
    case "upsert":
      return gatedWrite(body.clienteId, body.version, body.tokenHash, {
        vehicles: body.vehicles,
        generatedAt: body.generatedAt,
      });
    case "delete":
      return gatedWrite(body.clienteId, body.version, null, null);
    case "reconcile":
      // ponytail: one parameter per live id, so ~65k customers is the ceiling
      // (pg bind limit); a workshop is far below it. Chunk or `<> ALL($1::text[])` past that.
      await db
        .delete(portalCustomer)
        .where(and(notInArray(portalCustomer.clienteId, body.liveClienteIds), lt(portalCustomer.version, body.maxVersion)));
      return { applied: true };
    case "feedback": {
      // status, internal_note and received_at come from the column defaults:
      // the portal clock stamps arrival, the workshop never dictates it.
      const { id, username, role, category, text, route, screenLabel, createdAt } = body;
      const rows = await db
        .insert(supportFeedback)
        .values({ id, username, role, category, text, route, screenLabel, createdAt: new Date(createdAt) })
        .onConflictDoNothing({ target: supportFeedback.id })
        .returning({ id: supportFeedback.id });
      return { applied: rows.length > 0 };
    }
    case "usage":
      return applyUsage(body);
  }
}
