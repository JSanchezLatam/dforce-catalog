import { NextResponse, type NextRequest } from "next/server";

import { getUserProfile } from "@/modules/account/queries";
import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { createFeedback, FeedbackValidationError, type CreateFeedbackDeps } from "@/modules/feedback/service";

export type SendFeedbackDeps = {
  /** Resolves the author's username from the session user id; null when the user is gone. */
  getUsername?: (userId: string) => Promise<string | null>;
  createDeps?: CreateFeedbackDeps;
};

const defaultGetUsername = async (userId: string) => (await getUserProfile(userId))?.username ?? null;

/** Store-only: persists the row and answers `queued`. The author is the SESSION user, never the body. */
export async function handleSendFeedback(request: NextRequest, deps: SendFeedbackDeps = {}): Promise<NextResponse> {
  let user;
  try {
    user = requireSession(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(user, "feedback.send")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "validation_error", errors: { form: "No se pudo leer el pedido." } }, { status: 400 });
  }

  const username = await (deps.getUsername ?? defaultGetUsername)(user.id);
  if (username === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await createFeedback(
      { userId: user.id, username, role: user.role, category: body.category, text: body.text, route: body.route },
      deps.createDeps,
    );
    return NextResponse.json({ id, outcome: "queued" }, { status: 201 });
  } catch (err) {
    if (err instanceof FeedbackValidationError) {
      return NextResponse.json({ error: "validation_error", errors: err.errors }, { status: 400 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSendFeedback(request);
}
