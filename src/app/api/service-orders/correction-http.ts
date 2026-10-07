/**
 * The photo routes' half of closed-order-lock: try the plain mutation, and only
 * when the order turns out to be closed verify the administrator's password
 * (outside the transaction: bcrypt must not hold the row lock) and retry with
 * the grant. A password sent for an open order is therefore never checked, and a
 * tecnico's never is. Same rule as `[id]/route.ts`, but the photo routes keep
 * their own `{ error, message }` shapes (`order_closed` / `forbidden`) where
 * PATCH answers `{ errors: { form } }`; wrong password and throttled match.
 *
 * ponytail: the PATCH route keeps its own copy of this; fold it onto
 * `attemptWithCorrection` when that file is next touched.
 */
import { NextResponse } from "next/server";

import { authorizeCorrection, CorrectionRefusedError } from "@/modules/service-orders/correction-auth";
import { OrderClosedError, type CorrectionGrant } from "@/modules/service-orders/order-lock";

export type Authorize = (userId: string, password: string) => Promise<CorrectionGrant>;

/** The full window: the throttle does not expose "until the oldest failure ages out". */
const RETRY_AFTER_SECONDS = "900";

export async function attemptWithCorrection<T>(
  user: { id: string },
  canCorrect: boolean,
  password: string | undefined,
  run: (correction?: CorrectionGrant) => Promise<T>,
  authorize: Authorize = authorizeCorrection,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof OrderClosedError) || password === undefined || !canCorrect) {
      throw err;
    }
  }
  return run(await authorize(user.id, password));
}

/** The response for a refused correction or a closed order, or `null` for any other error. */
export function correctionErrorResponse(err: unknown, canCorrect: boolean): NextResponse | null {
  if (err instanceof CorrectionRefusedError) {
    if (err.reason === "throttled") {
      return NextResponse.json(
        { error: "throttled", message: "Demasiados intentos. Probá de nuevo en 15 minutos." },
        { status: 429, headers: { "Retry-After": RETRY_AFTER_SECONDS } },
      );
    }
    return err.reason === "wrong_password"
      ? NextResponse.json({ error: "wrong_password", message: "Contraseña incorrecta" }, { status: 403 })
      : NextResponse.json({ error: "forbidden", message: "Solo un administrador puede corregir una orden cerrada." }, { status: 403 });
  }
  if (err instanceof OrderClosedError) {
    // Someone who may not correct is refused (403), password or not; an administrator without one is told it is closed (409).
    return canCorrect
      ? NextResponse.json({ error: "order_closed", message: err.message }, { status: 409 })
      : NextResponse.json({ error: "forbidden", message: "Solo un administrador puede corregir una orden cerrada." }, { status: 403 });
  }
  return null;
}
