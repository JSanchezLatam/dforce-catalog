"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { landingPathFor } from "@/modules/auth/landing";
import { authenticateUser } from "@/modules/auth/authenticate";
import { clientIp } from "@/modules/auth/client-ip";
import { isUntilUnlocked } from "@/modules/auth/login-lock";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { TWO_FACTOR_PATH, TWO_FACTOR_SETUP_PATH } from "@/modules/auth/two-factor-gate";

export type LoginState = { error: string; detail?: string; lockedUsername?: string; retryAt?: number } | null;

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

  const result = await authenticateUser(username, password, { ip: clientIp(await headers()) });
  if (!result.ok) {
    if (!result.lockedUntil) return { error: "Usuario o contraseña incorrectos." };
    if (isUntilUnlocked(result.lockedUntil)) {
      return {
        error: "Demasiados intentos fallidos.",
        detail: "Por seguridad, el acceso quedó bloqueado. Pedí al administrador que te desbloquee.",
      };
    }
    const minutes = Math.ceil((result.lockedUntil.getTime() - Date.now()) / 60_000);
    return {
      error: "Demasiados intentos fallidos.",
      detail: `Por seguridad, el acceso quedó bloqueado. Intentá de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"} o pedí al administrador que te desbloquee.`,
      lockedUsername: username,
      retryAt: result.lockedUntil.getTime(),
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    expires: result.expiresAt,
    path: "/",
  });

  if (result.pending === "verify") redirect(TWO_FACTOR_PATH);
  if (result.pending === "enroll") redirect(TWO_FACTOR_SETUP_PATH);
  redirect(landingPathFor(result.role));
}
