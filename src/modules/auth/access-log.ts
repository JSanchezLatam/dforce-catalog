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
  failed: ["bad_password", "unknown_user", "inactive"],
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
  unlocked: "Desbloqueo manual",
};

export function describeAttempt(outcome: LoginOutcome): { result: AccessLogResult; detail: string } {
  const result = (Object.keys(RESULT_OUTCOMES) as AccessLogResult[]).find((r) => RESULT_OUTCOMES[r].includes(outcome))!;
  return { result, detail: DETAIL[outcome] };
}
