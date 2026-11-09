import { eq } from "drizzle-orm";

import type { Role } from "@/modules/auth/roles";
import { db } from "@/shared/db/client";
import { feedback, type Feedback } from "@/shared/db/schema";
import { FEEDBACK_MAX_LENGTH, isFeedbackCategory, type FeedbackCategory } from "./categories";
import { routeOf, screenLabelFor } from "./screen-labels";

const MAX_ROUTE_LENGTH = 200;

export type FeedbackRow = Feedback;

export type NewFeedback = {
  userId: string;
  username: string;
  role: Role;
  category: FeedbackCategory;
  text: string;
  route: string;
  screenLabel: string;
};

export type CreateFeedbackInput = Omit<NewFeedback, "screenLabel">;

export class FeedbackValidationError extends Error {
  constructor(public readonly errors: Record<string, string>) {
    super("Invalid feedback input");
  }
}

export type CreateFeedbackDeps = {
  insert?: (row: NewFeedback) => Promise<{ id: string }>;
};

/** Author and role come from the caller (the session), never from a request body. */
export async function createFeedback(
  input: CreateFeedbackInput,
  deps?: CreateFeedbackDeps,
): Promise<{ id: string }> {
  const text = input.text.trim();
  const errors: Record<string, string> = {};
  if (!isFeedbackCategory(input.category)) errors.category = "Elegí qué querés contarnos.";
  if (text.length === 0) errors.text = "Escribí tu comentario antes de enviarlo.";
  else if (text.length > FEEDBACK_MAX_LENGTH) errors.text = `El comentario no puede superar los ${FEEDBACK_MAX_LENGTH} caracteres.`;
  // Portal parse rejects route > 300, no leading "/" and label > 200; an unmapped route is its own label, so cap at 200.
  const route = typeof input.route === "string" ? routeOf(input.route) : null;
  if (route === null || !route.startsWith("/") || route.length > MAX_ROUTE_LENGTH) errors.route = "Pantalla inválida.";
  if (Object.keys(errors).length > 0) throw new FeedbackValidationError(errors);

  const row: NewFeedback = { ...input, text, route: route as string, screenLabel: screenLabelFor(input.route) };
  const insert =
    deps?.insert ??
    (async (r: NewFeedback) => {
      const [created] = await db.insert(feedback).values(r).returning({ id: feedback.id });
      return created;
    });
  return insert(row);
}

export type ListOwnFeedbackDeps = {
  select?: (userId: string) => Promise<FeedbackRow[]>;
};

/** Own rows only, newest first. Sorted here so the order does not depend on the query. */
export async function listOwnFeedback(userId: string, deps?: ListOwnFeedbackDeps): Promise<FeedbackRow[]> {
  const select = deps?.select ?? ((id: string) => db.select().from(feedback).where(eq(feedback.userId, id)));
  const rows = await select(userId);
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
