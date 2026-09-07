"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authenticateUser } from "@/modules/auth/authenticate";
import { SESSION_COOKIE } from "@/modules/auth/session";

export type LoginState = { error: string } | null;

/**
 * Server Action driving `LoginForm.tsx` via `useActionState` (React
 * 19 / Next.js 16 current pattern — replaces the old
 * `fetch("/api/login")` + manual pending/error `useState` plumbing).
 * Shares `authenticateUser()` with the `/api/login` Route Handler so the
 * credential check and error semantics stay identical between the two
 * entry points (R9.1/9.2 — generic error on any failure, no
 * user-enumeration signal).
 */
export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await authenticateUser(username, password);
  if (!result.ok) {
    return { error: "Usuario o contraseña incorrectos." };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    expires: result.expiresAt,
    path: "/",
  });

  redirect("/inventory");
}
