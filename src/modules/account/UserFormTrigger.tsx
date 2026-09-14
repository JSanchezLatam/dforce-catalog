"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useToast } from "@/shared/ui/ToastProvider";
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
  const { addToast } = useToast();
  return (
    <UserForm
      user={user}
      triggerLabel={triggerLabel}
      onSaved={() => {
        // `user` is what tells edit from create, the same flag `UserForm`
        // reads for its own `isEdit`. Toast before `router.refresh()`, as in
        // `OrderStatusControls`: the save is already committed, so a refresh
        // that throws must not swallow the only confirmation of it.
        addToast("success", user ? "Usuario actualizado" : "Usuario creado");
        router.refresh();
      }}
    />
  );
}
