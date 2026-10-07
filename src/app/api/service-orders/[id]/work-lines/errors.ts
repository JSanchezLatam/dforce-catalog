/**
 * The work-line routes' shared error → response mapping. The `can()` checks stay
 * in each route file (the route-guards test reads them there); this only turns a
 * thrown error into a response, `null` for anything it does not know.
 */
import { NextResponse } from "next/server";

import { OrderEditForbiddenError } from "@/modules/service-orders/order-lock";
import { OrdenServicioNotFoundError } from "@/modules/service-orders/service";
import {
  WorkLineForbiddenError,
  WorkLineNotFoundError,
  WorkLineRefusedError,
  WorkLineValidationError,
} from "@/modules/service-orders/work-lines";
import { correctionErrorResponse } from "../../correction-http";

export function workLineErrorResponse(err: unknown, canCorrect: boolean): NextResponse | null {
  if (err instanceof OrdenServicioNotFoundError || err instanceof WorkLineNotFoundError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (err instanceof WorkLineValidationError) return NextResponse.json({ errors: err.errors }, { status: 400 });
  if (err instanceof WorkLineForbiddenError) {
    return NextResponse.json({ error: "forbidden", message: err.message }, { status: 403 });
  }
  if (err instanceof WorkLineRefusedError) {
    return NextResponse.json({ error: "parte_lista", message: err.message }, { status: 409 });
  }
  if (err instanceof OrderEditForbiddenError) {
    return NextResponse.json(
      { error: "order_status", message: "La orden no admite líneas de trabajo en este estado." },
      { status: 409 },
    );
  }
  return correctionErrorResponse(err, canCorrect);
}
