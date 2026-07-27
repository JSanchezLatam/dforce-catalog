import { eq } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";

import { db as defaultDb } from "@/shared/db/client";
import { workshopConfig, type WorkshopConfig } from "@/shared/db/schema";

const SINGLETON_ID = "singleton";
const MAX_NAME_LENGTH = 100;

export type WorkshopConfigInput = {
  name: string | null;
};

export class WorkshopConfigValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid workshop config");
  }
}

export function validateWorkshopConfigInput(input: unknown): WorkshopConfigInput {
  const errors: Record<string, string> = {};
  const value = (input ?? {}) as Record<string, unknown>;

  const name = typeof value.name === "string" ? value.name.trim() : null;
  if (name !== null && name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be ${MAX_NAME_LENGTH} characters or less`;
  }

  if (Object.keys(errors).length > 0) {
    throw new WorkshopConfigValidationError(errors);
  }

  return { name };
}

export async function getWorkshopConfig(
  db: { select: typeof defaultDb.select } = defaultDb,
): Promise<WorkshopConfig | null> {
  const rows = await db.select().from(workshopConfig).where(eq(workshopConfig.id, SINGLETON_ID)).limit(1);
  return rows[0] ?? null;
}

export async function saveWorkshopConfig(
  input: unknown,
  db: { insert: typeof defaultDb.insert } = defaultDb,
): Promise<WorkshopConfig> {
  const { name } = validateWorkshopConfigInput(input);
  const updatedAt = new Date();
  const [row] = await db
    .insert(workshopConfig)
    .values({ id: SINGLETON_ID, name, updatedAt })
    .onConflictDoUpdate({ target: workshopConfig.id, set: { name, updatedAt } })
    .returning();
  return row;
}
