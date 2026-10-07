// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { PortalVehicle } from "../../src/contract";
import { TERMS_VERSION } from "../../src/terms";
import { PortalClient } from "./PortalClient";

const TOKEN = "tok-secret-123";
const INVALID = "Este enlace no es válido. Pedí uno nuevo en el taller.";
const vehicles: PortalVehicle[] = [
  {
    id: "v1",
    plate: "AB1234",
    make: "Toyota",
    model: null,
    year: 2015,
    orders: [
      {
        id: "ord-1",
        status: "Terminada",
        categoria: "Instalación de audio",
        createdAt: "2026-09-01T15:00:00.000Z",
        appointmentAt: null,
        completedAt: null,
        description: null,
        hallazgos: null,
        recomendaciones: null,
      },
    ],
  },
];
const snapshot = { vehicles, generatedAt: "2026-10-01T15:30:00.000Z" };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const events: string[] = [];
let fetchMock: Mock<(path: string, init: RequestInit) => Promise<Response>>;
const answer = (...responses: (Response | Error)[]) => {
  fetchMock = vi.fn(async () => {
    events.push("fetch");
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
};
const openAt = (hash: string) => {
  window.history.replaceState(null, "", `/c${hash}`);
  events.length = 0; // the test setup is not the component
};

beforeEach(() => {
  events.length = 0;
  const real = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    events.push("replaceState");
    real(...args);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("PortalClient", () => {
  it("strips the fragment BEFORE the first fetch and sends the token only in the POST body", async () => {
    openAt(`#${TOKEN}`);
    answer(json(404, { state: "invalid" }));
    render(<PortalClient />);
    await screen.findByText(INVALID);
    expect(events).toEqual(["replaceState", "fetch"]);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    const [url, init] = fetchMock.mock.calls[0] ;
    expect(url).toBe("/api/c/open");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(JSON.stringify(init.headers ?? {})).not.toContain(TOKEN);
    expect(url).not.toContain(TOKEN);
  });

  it.each(["", "#"])("shows the neutral page without any request for the fragment %j", async (hash) => {
    openAt(hash);
    answer();
    render(<PortalClient />);
    await screen.findByText(INVALID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the same neutral page when the token is unknown", async () => {
    openAt(`#${TOKEN}`);
    answer(json(404, { state: "invalid" }));
    render(<PortalClient />);
    expect(await screen.findByText(INVALID)).toBeTruthy();
    expect(screen.queryByText("Acepto")).toBeNull();
  });

  it("shows the terms and no data before Acepto", async () => {
    openAt(`#${TOKEN}`);
    answer(json(200, { state: "terms" }));
    const { container } = render(<PortalClient />);
    const accept = await screen.findByRole("button", { name: "Acepto" });

    expect(accept.className).toContain("btn");
    expect(screen.getByText("TEXTO PROVISORIO — pendiente de revisión legal")).toBeTruthy();
    expect(screen.getByText(new RegExp(TERMS_VERSION))).toBeTruthy();
    expect(screen.getByText(/fuera de Panamá/)).toBeTruthy();
    expect(screen.getByText(/pedilo en el taller/)).toBeTruthy();
    expect(container.querySelector("input, textarea, select, form")).toBeNull();
    expect(container.textContent).not.toContain("AB1234");
  });

  it("Acepto calls accept with the token in the body and renders the history", async () => {
    openAt(`#${TOKEN}`);
    answer(json(200, { state: "terms" }), json(200, { state: "accepted", snapshot }));
    render(<PortalClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Acepto" }));

    expect(await screen.findByText("AB1234")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[1] ;
    expect(url).toBe("/api/c/accept");
    expect(init.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(screen.queryByRole("button", { name: "Acepto" })).toBeNull();
  });

  it("an already accepted token goes straight to snapshot", async () => {
    openAt(`#${TOKEN}`);
    answer(json(200, { state: "accepted" }), json(200, { state: "accepted", snapshot }));
    render(<PortalClient />);
    expect(await screen.findByText("AB1234")).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/c/open", "/api/c/snapshot"]);
    expect(screen.queryByText("Acepto")).toBeNull();
  });

  it("a failed fetch shows a retry message and never data; retry reuses the token", async () => {
    openAt(`#${TOKEN}`);
    answer(new TypeError("Failed to fetch"), json(200, { state: "accepted" }), json(200, { state: "accepted", snapshot }));
    const { container } = render(<PortalClient />);
    await screen.findByText("No pudimos cargar tu historial. Revisá tu conexión e intentá de nuevo.");
    expect(container.textContent).not.toContain("AB1234");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("AB1234")).toBeTruthy();
    expect((fetchMock.mock.calls[1] )[1].body).toBe(JSON.stringify({ token: TOKEN }));
  });

  it("a failed accept keeps the terms up with an error and a way to try again", async () => {
    openAt(`#${TOKEN}`);
    answer(json(200, { state: "terms" }), json(500, { error: "boom" }), json(200, { state: "accepted", snapshot }));
    const { container } = render(<PortalClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Acepto" }));
    await screen.findByText("No pudimos registrar tu aceptación. Intentá de nuevo.");
    expect(container.textContent).not.toContain("AB1234");

    fireEvent.click(screen.getByRole("button", { name: "Acepto" }));
    expect(await screen.findByText("AB1234")).toBeTruthy();
  });

  it("a 429 tells the visitor to wait", async () => {
    openAt(`#${TOKEN}`);
    answer(json(429, { error: "too many requests" }));
    render(<PortalClient />);
    expect(await screen.findByText("Hiciste demasiados intentos seguidos. Esperá un minuto y volvé a probar.")).toBeTruthy();
  });

  it("a 200 with an unexpected body is an error, not a crash or a blank page", async () => {
    openAt(`#${TOKEN}`);
    answer(json(200, { state: "accepted" }), json(200, { state: "accepted" }));
    render(<PortalClient />);
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  });
});
