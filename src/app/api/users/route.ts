import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession } from "@/modules/auth/session";
import { listUsers as listUsersQuery } from "@/modules/account/queries";
import {
  createUser as createUserService,
  DuplicateEmailError,
  DuplicateUsernameError,
  ProfileValidationError,
  type CreateUserDeps,
} from "@/modules/account/service";

/**
 * The `can()` check runs BEFORE the body is read and before any dependency is
 * touched — spec `user-management` requires that a denied técnico not merely
 * receive a 403 but have no business logic execute at all.
 */
export async function handleListUsers(
  request: NextRequest,
  deps: { listUsers?: typeof listUsersQuery } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Strict equality against "true": anything else (a stray `1`, `yes`, an
  // empty value) falls back to the safe, smaller active-only set rather than
  // silently widening what the admin sees.
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "true";

  const list = deps.listUsers ?? listUsersQuery;
  const users = await list({ includeInactive });
  return NextResponse.json({ users });
}

export async function handleCreateUser(
  request: NextRequest,
  deps: CreateUserDeps & { createUser?: typeof createUserService } = {},
): Promise<NextResponse> {
  const user = requireSession(request);
  if (!can(user, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { createUser: injected, ...serviceDeps } = deps;
  const create = injected ?? createUserService;

  try {
    const created = await create(body, serviceDeps);
    return NextResponse.json({ user: created }, { status: 201 });
  } catch (err) {
    if (err instanceof ProfileValidationError) {
      return NextResponse.json({ errors: err.errors }, { status: 400 });
    }
    // Distinct codes, not one generic 409: the form needs to know which field
    // to mark, and a username collision is the more common admin mistake.
    if (err instanceof DuplicateUsernameError) {
      return NextResponse.json({ error: "duplicate_username" }, { status: 409 });
    }
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json({ error: "duplicate_email" }, { status: 409 });
    }
    throw err;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleListUsers(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCreateUser(request);
}
