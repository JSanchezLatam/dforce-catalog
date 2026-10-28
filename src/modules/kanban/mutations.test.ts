import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moveOrder, setUrgent } from "./mutations";

// The exact bodies the routes return (src/app/api/service-orders/[id]/route.ts and .../urgent/route.ts).
// `orden` is the whole row from `transitionOrder`, dates as ISO strings after JSON.
const orden = (status: string) => ({
  id: "o1", clienteId: "c1", vehiculoId: "v1", status, esperaMotivo: status === "on_hold" ? "repuesto" : null,
  categoria: "mant_preventivo", description: null, appointmentAt: null, completedAt: null, hallazgos: null,
  recomendaciones: null, observaciones: null, kilometraje: null, nivelCombustible: null, bateriaPct: null,
  urgenteAt: null, urgenteBy: null, createdBy: "u1", createdAt: "2026-10-27T15:00:00.000Z", updatedAt: "2026-10-27T15:05:00.000Z",
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const MOVE = { status: "on_hold", expectedStatus: "in_progress", esperaMotivo: "repuesto" } as const;

describe("moveOrder", () => {
  it("PATCHes the move and returns the status the server wrote", async () => {
    fetchMock.mockResolvedValue(json({ orden: orden("on_hold") }));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: true, status: "on_hold" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/service-orders/o1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual(MOVE);
  });

  it("places the card by orden.status, not by the target (booked -> open may land in diagnosing)", async () => {
    fetchMock.mockResolvedValue(json({ orden: orden("diagnosing") }));
    expect(await moveOrder("o1", { status: "open", expectedStatus: "booked" })).toEqual({ ok: true, status: "diagnosing" });
  });

  it("409 stale_status reads the board copy, not the server's agenda copy", async () => {
    fetchMock.mockResolvedValue(json({ error: "stale_status", message: "La orden cambió mientras la mirabas. Actualizá la agenda." }, 409));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "La orden cambió mientras la mirabas. Actualizá el tablero." });
  });

  it("a 409 that is not stale_status is shown with its own message", async () => {
    fetchMock.mockResolvedValue(json({ errors: { form: "No se puede editar una orden completada o cancelada." } }, 409));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "No se puede editar una orden completada o cancelada." });
  });

  it("reads errors.form, then errors.esperaMotivo, then message", async () => {
    fetchMock.mockResolvedValueOnce(json({ errors: { form: "Completá el vehículo y la categoría antes de recibir la orden" } }, 400));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "Completá el vehículo y la categoría antes de recibir la orden" });
    fetchMock.mockResolvedValueOnce(json({ errors: { esperaMotivo: "Elegí un motivo de espera" } }, 400));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "Elegí un motivo de espera" });
    fetchMock.mockResolvedValueOnce(json({ errors: { esperaMotivo: "segundo", form: "primero" } }, 400));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "primero" });
    fetchMock.mockResolvedValueOnce(json({ errors: { form: "" }, message: "Solo un administrador puede hacerlo." }, 403));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "Solo un administrador puede hacerlo." });
    fetchMock.mockResolvedValueOnce(
      json({ error: "forbidden", message: "Solo un administrador o el jefe de taller puede cerrar, cancelar o devolver una orden." }, 403),
    );
    expect(await moveOrder("o1", MOVE)).toEqual({
      ok: false,
      error: "Solo un administrador o el jefe de taller puede cerrar, cancelar o devolver una orden.",
    });
  });

  it("falls back to a generic line for bodies with no Spanish message (invalid_transition, Forbidden, not a body)", async () => {
    const generic = "No se pudo mover la orden. Intentalo de nuevo.";
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_transition", from: "open", to: "done" }, 400));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: generic });
    fetchMock.mockResolvedValueOnce(json({ error: "Forbidden" }, 403));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: generic });
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: generic });
  });

  it("a rejected fetch is the shared connection error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: false, error: "No se pudo conectar. Revisa tu conexión e intenta de nuevo." });
  });

  it("a 2xx with a body that carries no known status is placed where it was sent", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    expect(await moveOrder("o1", MOVE)).toEqual({ ok: true, status: "on_hold" });
  });
});

describe("setUrgent", () => {
  it("POSTs to mark and DELETEs to clear", async () => {
    fetchMock.mockResolvedValue(json({ urgent: true }));
    expect(await setUrgent("o1", true)).toEqual({ ok: true });
    fetchMock.mockResolvedValue(json({ urgent: false }));
    expect(await setUrgent("o1", false)).toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/service-orders/o1/urgent", "POST"],
      ["/api/service-orders/o1/urgent", "DELETE"],
    ]);
  });

  it("a closed order (409 order_closed) shows the route's message", async () => {
    fetchMock.mockResolvedValue(
      json({ error: "order_closed", message: "La orden está cerrada y ya no se puede cambiar si es urgente." }, 409),
    );
    expect(await setUrgent("o1", true)).toEqual({ ok: false, error: "La orden está cerrada y ya no se puede cambiar si es urgente." });
  });

  it("404 and 403 carry no message and read the generic line", async () => {
    const generic = "No se pudo cambiar la marca de urgente. Intentalo de nuevo.";
    fetchMock.mockResolvedValueOnce(json({ error: "not_found" }, 404));
    expect(await setUrgent("o1", true)).toEqual({ ok: false, error: generic });
    fetchMock.mockResolvedValueOnce(json({ error: "Forbidden" }, 403));
    expect(await setUrgent("o1", true)).toEqual({ ok: false, error: generic });
  });

  it("a rejected fetch is the shared connection error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await setUrgent("o1", true)).toEqual({ ok: false, error: "No se pudo conectar. Revisa tu conexión e intenta de nuevo." });
  });
});
