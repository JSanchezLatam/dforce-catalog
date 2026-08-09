import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import {
  AdminSafetyError,
  deactivateUser as deactivateUserService,
  DuplicateEmailError,
  DuplicateUsernameError,
  ProfileValidationError,
  reactivateUser as reactivateUserService,
  updateUser as updateUserService,
  UserNotFoundError,
} from "@/modules/account/service";

type UpdateUserDeps = {
  updateUser?: typeof updateUserService;
  deactivateUser?: typeof deactivateUserService;
  reactivateUser?: typeof reactivateUserService;
};

/**
 * One PATCH covers field edits, admin password resets, and activation changes,
 * because the admin UI reaches all three from the same row.
 *
 * Activation is routed to `deactivateUser()`/`reactivateUser()` rather than
 * folded into `updateUser()`: deactivation needs its own transaction around
 * the active-admin count, and reactivation deliberately skips the guard
 * entirely (raising the admin count can never violate the floor).
 */
export async function handleUpdateUser(
  request: NextRequest,
  id: string,
  deps: UpdateUserDeps = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Whitelisted, not spread: forwarding arbitrary body keys would let a
  // caller reach any column a future `updateUser` learns to write, and it is
  // what would have let `body.actorId` ride along below.
  const fields: Record<string, unknown> = {};
  for (const key of ["name", "email", "role", "password"] as const) {
    if (body?.[key] !== undefined) fields[key] = body[key];
  }
  const active = body?.active;

  const update = deps.updateUser ?? updateUserService;
  const deactivate = deps.deactivateUser ?? deactivateUserService;
  const reactivate = deps.reactivateUser ?? reactivateUserService;

  try {
    // The actor is always the session identity — never `body.actorId`, which
    // would let an admin forge who performed the change and sidestep the
    // self-mutation half of checkAdminSafety().
    if (Object.keys(fields).length > 0) {
      await update(user.id, id, fields);
    }

    if (active === false) {
      await deactivate(user.id, id);
    } else if (active === true) {
      await reactivate(id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AdminSafetyError) {
      // The reason travels to the client so the table can render a specific
      // inline message instead of a generic failure.
      return NextResponse.json({ error: err.reason }, { status: 400 });
    }
    if (err instanceof ProfileValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 });
    }
    if (err instanceof DuplicateUsernameError) {
      return NextResponse.json({ error: "duplicate_username" }, { status: 409 });
    }
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json({ error: "duplicate_email" }, { status: 409 });
    }
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return handleUpdateUser(request, id);
}
