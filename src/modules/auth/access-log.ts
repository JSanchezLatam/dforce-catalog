import type { LoginOutcome } from "./login-lock";

/**
 * "Registro de accesos" (S10): the filters and the reading of each attempt.
 * Pure and client-safe; the filter controls import the labels from here.
 */
export const ACCESS_LOG_RESULTS = {
  success: "Exitoso",
  failed: "Fallido",
  locked: "Bloqueado",
  unlocked: "Desbloqueado",
} as const;
export type AccessLogResult = keyof typeof ACCESS_LOG_RESULTS;

export const ACCESS_LOG_PERIODS = {
  1: "Últimas 24 horas",
  7: "Últimos 7 días",
  30: "Últimos 30 días",
  90: "Últimos 90 días",
} as const;
export type AccessLogPeriod = keyof typeof ACCESS_LOG_PERIODS;
export const DEFAULT_PERIOD: AccessLogPeriod = 7;

export const RESULT_OUTCOMES: Record<AccessLogResult, readonly LoginOutcome[]> = {
  success: ["success"],
  failed: ["bad_password", "unknown_user", "inactive", "password_ok", "bad_code"],
  locked: ["locked"],
  unlocked: ["unlocked"],
};

export type AccessLogFilters = { user?: string; result?: AccessLogResult; days: AccessLogPeriod };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A stale or hand-typed link falls back to the default instead of an error page; `hasOwn`, so `toString` is not a result. */
export function parseAccessLogFilters(params: SearchParams): AccessLogFilters {
  const user = first(params.user);
  const result = first(params.result);
  const days = Number(first(params.days));
  return {
    ...(user ? { user } : {}),
    ...(result && Object.hasOwn(ACCESS_LOG_RESULTS, result) ? { result: result as AccessLogResult } : {}),
    days: Object.hasOwn(ACCESS_LOG_PERIODS, days) ? (days as AccessLogPeriod) : DEFAULT_PERIOD,
  };
}

const DETAIL: Record<LoginOutcome, string> = {
  success: "",
  bad_password: "Contraseña incorrecta",
  unknown_user: "Usuario desconocido",
  inactive: "Usuario desactivado",
  // The row does not record which lock refused it, so the copy names neither.
  locked: "Rechazado: acceso bloqueado",
  // Only the emergency command unlocks without a session (S13); an admin unlock names its actor.
  unlocked: "Desbloqueo de emergencia desde la PC del taller",
  // The second step was never passed: the row stays as the password left it.
  password_ok: "Falta el código de verificación",
  bad_code: "Código incorrecto",
};

export type SecondFactor = "totp" | "recovery" | "trusted_device";

const SECOND_FACTOR: Record<SecondFactor, string> = {
  totp: "Con 2FA",
  recovery: "Con código de recuperación",
  trusted_device: "Dispositivo de confianza",
};

/** `actor` is the administrator who unlocked, on `unlocked` rows; `secondFactor` how a success passed 2FA. */
export function describeAttempt(
  outcome: LoginOutcome,
  actor: string | null,
  secondFactor: SecondFactor | null = null,
): { result: AccessLogResult; detail: string } {
  const result = (Object.keys(RESULT_OUTCOMES) as AccessLogResult[]).find((r) => RESULT_OUTCOMES[r].includes(outcome))!;
  if (outcome === "unlocked" && actor) return { result, detail: `Desbloqueado por ${actor}` };
  if (outcome === "success" && secondFactor) return { result, detail: SECOND_FACTOR[secondFactor] };
  return { result, detail: DETAIL[outcome] };
}
