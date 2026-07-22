import { NextResponse, type NextRequest } from "next/server";

import { can } from "@/modules/auth/policy";
import { requireSession, type SessionUser } from "@/modules/auth/session";
import { getLatestSyncRun, hasActiveSyncRun, requestManualSync, SyncAlreadyRunningError } from "@/modules/inventory-sync/job";

/**
 * R2 — manual sync trigger + status polling (CRITICAL fix flagged by
 * sdd-verify: `requestManualSync()`/`hasActiveSyncRun()` existed and were
 * unit-tested since PR2/PR3, but nothing anywhere in `src/app/**` ever called
 * them — an Administrador had no way to reach this code). Admin-only
 * (`sync.manual`, R9.6/NFR-8), same `requireSession()` then `can()` gate as
 * `/api/template-config`. GET/status reuses the same `sync.manual` action
 * rather than adding a new read-only policy action — sync internals aren't a
 * Usuario-facing concern per R2's own "Administrador" wording.
 */
function resolveManualSyncAccess(request: NextRequest): SessionUser | NextResponse {
  const user = requireSession(request);
  if (!can(user, "sync.manual")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}

/**
 * R2.2/2.4 — polled by the UI while a sync is in flight; surfaces the last
 * run's count + timestamp once finished. Exported separately from `GET` (a
 * `deps` param would fail Next's own route-handler type check at build time —
 * `RouteHandlerConfig` requires the exact `(request, { params })` signature)
 * so route.test.ts can still inject fakes.
 */
export async function handleManualSyncStatus(
  request: NextRequest,
  deps: { hasActiveSyncRun?: typeof hasActiveSyncRun; getLatestSyncRun?: typeof getLatestSyncRun } = {},
): Promise<NextResponse> {
  const access = resolveManualSyncAccess(request);
  if (access instanceof NextResponse) return access;

  const running = await (deps.hasActiveSyncRun ?? hasActiveSyncRun)();
  const lastRun = await (deps.getLatestSyncRun ?? getLatestSyncRun)();
  return NextResponse.json({ running, lastRun });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleManualSyncStatus(request);
}

/** R2.1/2.5 — triggers an immediate sync; rejects with 409 while one is already running. Same DI-vs-Next-typing split as `handleManualSyncStatus` above. */
export async function handleManualSyncTrigger(
  request: NextRequest,
  deps: { requestManualSync?: typeof requestManualSync } = {},
): Promise<NextResponse> {
  const access = resolveManualSyncAccess(request);
  if (access instanceof NextResponse) return access;

  try {
    await (deps.requestManualSync ?? requestManualSync)(access.id);
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (err) {
    if (err instanceof SyncAlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 }); // R2.5
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleManualSyncTrigger(request);
}
