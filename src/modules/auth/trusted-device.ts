import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, lte, sql, type SQL } from "drizzle-orm";

import { db } from "@/shared/db/client";
import { trustedDevices } from "@/shared/db/schema";

/**
 * Trusted devices (S3, L45): a browser that passed the code with the box
 * checked skips it for 30 days. The cookie holds a random token; the database
 * holds only its SHA-256, so a copy of the database cannot replay a device.
 * The token is made here with `node:crypto`, never in the browser, which runs
 * over plain HTTP (AGENTS.md).
 */

export const TRUSTED_DEVICE_COOKIE = "trusted_device";
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Tx, "insert" | "delete" | "select">;

/** SHA-256 in hex; a 256-bit random token needs no salt or slow hash. */
export const hashDeviceToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Stores a new device for `userId` and returns the token for the cookie, the only place it exists. */
export async function trustDevice(
  userId: string,
  executor: Executor = db,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS);
  await executor
    .insert(trustedDevices)
    .values({ id: randomUUID(), userId, tokenHash: hashDeviceToken(token), expiresAt, createdAt: now });
  return { token, expiresAt };
}

/** Whether `token` is an unexpired device of this same user; another user's cookie never counts. */
export async function isTrustedDevice(userId: string, token: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.tokenHash, hashDeviceToken(token)),
        eq(trustedDevices.userId, userId),
        gt(trustedDevices.expiresAt, now),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Forgets every device of the user: password change (S9), 2FA disable, 2FA reset
 * (A5), deactivation, "Olvidar". The one implementation every path calls: it
 * only needs `execute`, so a Drizzle transaction and the account service's
 * execute-only transaction seam both fit.
 */
export async function revokeTrustedDevices(
  userId: string,
  executor: { execute: (query: SQL) => Promise<unknown> } = db,
): Promise<void> {
  await executor.execute(sql`DELETE FROM ${trustedDevices} WHERE ${trustedDevices.userId} = ${userId}`);
}

/** The daily retention's half for devices: only expired rows go. */
export async function purgeExpiredTrustedDevices(now = new Date()): Promise<number> {
  const deleted = await db
    .delete(trustedDevices)
    .where(lte(trustedDevices.expiresAt, now))
    .returning({ id: trustedDevices.id });
  return deleted.length;
}
