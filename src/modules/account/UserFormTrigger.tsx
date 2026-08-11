"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { UserForm, type UserFormUser } from "./UserForm";

/**
 * Thin client wrapper around `UserForm` for use from `users/page.tsx` (an
 * RSC). A Server Component cannot pass a plain function across the RSC
 * boundary, so this wrapper owns `useRouter()` and supplies
 * `onSaved={() => router.refresh()}` — re-running the page's `listUsers()`
 * without a full reload. Mirrors `CustomerFormTrigger.tsx`.
 */
export function UserFormTrigger({
  user,
  triggerLabel,
}: {
  user?: UserFormUser | null;
  triggerLabel?: ReactNode;
}) {
  const router = useRouter();
  return <UserForm user={user} triggerLabel={triggerLabel} onSaved={() => router.refresh()} />;
}
